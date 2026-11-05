import express from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import fs from "fs/promises";
import mongoose from "mongoose";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync=promisify(execFile);
import { escapeRegex, detectMime, detectMimeFromBytes } from "./util.js";
import { verifyFindings, urgency, ageFromDob, normSex } from "./reportRules.js";
import { checkRedFlags } from "./safety.js";
import { makeTextPdf, makeReportPdf, makePrescriptionPdf } from "./pdf.js";
import { z } from "zod";
import { User, PrivateFile, Appointment, Message, AuditEvent, Medicine, Prescription, CallSignal, MedicalReport, Notification, SystemError, CallSession, Setting, ResetRequest } from "./models.js";
import { auth, allow, hashPassword, verifyPassword, makeToken, audit } from "./security.js";
import { config } from "./config.js";
import { resolveStoredFilePath, readStoredFileBuffer, storeGridFSBuffer, deleteGridFSFile } from "./fileStorage.js";

const router = express.Router();
const sensitiveLimiter=rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:true,legacyHeaders:false,message:{error:"Too many attempts. Try again later."}});
const uploadDir = config.uploadDir;
await fs.mkdir(uploadDir, {recursive:true});

const storage = multer.memoryStorage();
const upload = multer({
  storage, limits:{fileSize:config.maxUploadMb*1024*1024, files:5},
  fileFilter:(_req,file,cb) => {
    const allowed = ["application/pdf","image/jpeg","image/png","image/webp","audio/mpeg","audio/mp4","audio/ogg","audio/webm","audio/wav","video/mp4","video/webm","video/quicktime"];
    cb(allowed.includes(file.mimetype) ? null : new Error("Supported files: PDF, JPG, PNG, WEBP, MP3, M4A, OGG, WAV, MP4, WEBM, MOV"), allowed.includes(file.mimetype));
  }
});
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

const recordingUpload = multer({
  storage, limits:{fileSize:50*1024*1024,files:1},
  fileFilter:(_req,file,cb)=>{const ok=["audio/webm","audio/webm;codecs=opus","audio/ogg","audio/mp4","audio/mpeg"].includes(file.mimetype);cb(ok?null:new Error("Use a supported browser audio recording format"),ok);}
});
const EXT_BY_MIME={"application/pdf":".pdf","image/jpeg":".jpg","image/png":".png","image/webp":".webp","audio/webm":".webm","audio/ogg":".ogg","audio/mp4":".m4a","audio/mpeg":".mp3","audio/wav":".wav","video/mp4":".mp4","video/webm":".webm","video/quicktime":".mov"};
// Statuses in which an assigned doctor may see the patient's record / reports.
const DOCTOR_ACCESS_STATUSES=["requested","awaiting_records","awaiting_tests","confirmed","waiting_room","in_progress","completed","follow_up_required"];
// Statuses in which a prescription may be written.
const PRESCRIBE_STATUSES=["awaiting_records","awaiting_tests","confirmed","waiting_room","in_progress","completed","follow_up_required"];
const CLOSED_STATUSES=["completed","cancelled","rejected"];
const mkLimiter=(minutes,limit,error)=>rateLimit({windowMs:minutes*60*1000,limit,standardHeaders:true,legacyHeaders:false,message:{error}});
const loginLimiter=mkLimiter(15,20,"Too many sign-in attempts. Try again later.");
const applyLimiter=mkLimiter(60,10,"Too many submissions. Try again later.");
const aiLimiter=mkLimiter(60,20,"AI question limit reached. Try again later.");
const otpLimiter=mkLimiter(15,15,"Too many attempts. Try again in a few minutes.");
const DUMMY_HASH=await hashPassword("timing-equalisation-only");

async function removeFiles(_files){ /* memoryStorage: no temporary upload files to clean up */ }
// Reject uploads whose real content (magic bytes) does not match the declared type.
const validateUploads=async(req,res,next)=>{
  try{
    const files=[...(Array.isArray(req.files)?req.files:[]),...(req.file?[req.file]:[])];
    for(const f of files){
      const actual=detectMimeFromBytes(f.buffer||Buffer.alloc(0));
      const compatible=actual===f.mimetype || (actual==="video/webm"&&f.mimetype.startsWith("audio/webm")) || (actual==="video/mp4"&&["audio/mp4","video/quicktime"].includes(f.mimetype));
      if(!compatible){
        await removeFiles(files);
        return res.status(400).json({error:"File content does not match its type. Upload a real PDF, JPG, PNG or WEBP file."});
      }
    }
    next();
  }catch(e){next(e);}
};
const DOCTOR_DOC_CATEGORIES=["doctor_photo","bmdc_certificate","degree_certificate","identity_document","other_qualification","other"];
async function saveDoctorDocs(userId,files,body){
  for(let i=0;i<files.length;i++){
    const f=files[i], category=String(body[`category_${i}`]||"other");
    const gridId=await storeGridFSBuffer({buffer:f.buffer,filename:f.originalname,mimeType:f.mimetype,metadata:{ownerId:String(userId),category}});
    await PrivateFile.create({ownerId:userId,uploadedBy:userId,category:DOCTOR_DOC_CATEGORIES.includes(category)?category:"other",originalName:f.originalname,storedName:String(gridId),storageProvider:"gridfs",mimeType:f.mimetype,size:f.size});
  }
}
function prescriptionCanonical(rx){
  const payload={id:String(rx._id),appointmentId:String(rx.appointmentId),patientId:String(rx.patientId),doctorId:String(rx.doctorId?._id||rx.doctorId),signerName:rx.signerName,signerBmdc:rx.signerBmdc,signedAt:rx.signedAt.toISOString(),items:rx.items.map(x=>({brand:x.brand,generic:x.generic,strength:x.strength,form:x.form,dose:x.dose,frequency:x.frequency,duration:x.duration,instructions:x.instructions})),notes:rx.notes||""};
  // Preserve compatibility with prescriptions signed before image snapshots existed.
  if(rx.signatureImageHash||rx.signatureImageFileId){payload.signatureImageFileId=String(rx.signatureImageFileId||"");payload.signatureImageHash=String(rx.signatureImageHash||"");}
  return JSON.stringify(payload);
}

function cleanRxItems(raw){
  if(!Array.isArray(raw)||raw.length<1||raw.length>30) return {error:"Add 1-30 prescription items"};
  const items=raw.map(x=>{x=x||{};return {brand:String(x.brand||"").slice(0,120),generic:String(x.generic||"").trim().slice(0,160),strength:String(x.strength||"").slice(0,60),form:String(x.form||"").slice(0,40),dose:String(x.dose||"").trim().slice(0,120),frequency:String(x.frequency||"").trim().slice(0,120),duration:String(x.duration||"").trim().slice(0,120),instructions:String(x.instructions||"").slice(0,500),medicineId:mongoose.isValidObjectId(x.medicineId)?x.medicineId:undefined};});
  if(items.some(x=>!x.generic||!x.dose||!x.frequency||!x.duration)) return {error:"Generic, dose, frequency and duration are required for every medicine"};
  return {items};
}

// Pending sign-up passwords are kept encrypted (AES-256-GCM, key derived from JWT_SECRET) only until the admin approves/rejects, so the admin can see and send them.
const PW_KEY=crypto.createHash("sha256").update("pending-password:"+config.jwtSecret).digest();
function sealPw(t){const iv=crypto.randomBytes(12);const c=crypto.createCipheriv("aes-256-gcm",PW_KEY,iv);const e=Buffer.concat([c.update(t,"utf8"),c.final()]);return [iv,c.getAuthTag(),e].map(b=>b.toString("base64")).join(".");}
function openPw(v){try{const [iv,tag,e]=String(v||"").split(".").map(x=>Buffer.from(x,"base64"));const d=crypto.createDecipheriv("aes-256-gcm",PW_KEY,iv);d.setAuthTag(tag);return Buffer.concat([d.update(e),d.final()]).toString("utf8");}catch{return "";}}
router.post("/auth/register", applyLimiter, wrap(async(req,res)=>{
  // Patient signs up with name, email and own password. A 6-digit code is emailed; the account opens only after the code is entered.
  // If email (SMTP) is not configured, falls back to the older admin-approval flow.
  const s=z.object({name:z.string().min(2).max(120),email:z.string().email(),password:z.string().min(12).max(128),phone:z.string().max(30).optional()}).safeParse(req.body);
  if(!s.success) return res.status(400).json({error:"Invalid details",details:s.error.flatten()});
  const email=s.data.email.toLowerCase();
  const existing=await User.findOne({$or:[{email},{contactEmail:email}]});
  if(existing && existing.status!=="pending_email") return res.status(409).json({error:"Email already registered"});
  if(!mailer()){
    if(existing) return res.status(409).json({error:"Email already registered"});
    const user=await User.create({name:s.data.name,email,contactEmail:email,phone:s.data.phone,passwordHash:await hashPassword(s.data.password),pendingPassword:sealPw(s.data.password),role:"patient",status:"pending_approval"});
    const admins=await User.find({role:"admin",status:"active"}).select("_id");
    for(const a of admins)await notify(a.id,"new_account_requested","New account request",`${user.name} (${email}${user.phone?", "+user.phone:""}) asked for a new account. Open Requests > New accounts to see their email and password and approve it. The person will be emailed after approval.`,"User",user.id);
    await audit(req,"patient.register_request","User",user.id);
    return res.status(201).json({message:"Your account request was sent to the admin. After approval, the admin will email you at this address. Then you can sign in with your email and password.",user:{id:user.id,name:user.name,email:user.email,role:user.role}});
  }
  let user=existing;
  if(user){user.name=s.data.name;user.phone=s.data.phone||"";user.passwordHash=await hashPassword(s.data.password);await user.save();}
  else user=await User.create({name:s.data.name,email,contactEmail:email,phone:s.data.phone,passwordHash:await hashPassword(s.data.password),role:"patient",status:"pending_email"});
  const code=await issueOtp(user,"signup");
  const sent=await sendMailSafe(email,"Your MedAI Hospital verification code",`Hello ${user.name},\n\nYour MedAI Hospital verification code is: ${code}\n\nIt is valid for 10 minutes. Enter it on the sign-up page to finish creating your account. If you did not sign up, ignore this email.\n\n- MedAI Hospital`);
  if(!sent){ if(!existing) await user.deleteOne(); return res.status(502).json({error:"Could not send the verification email. Check the email address and try again."}); }
  await audit(req,"patient.register_code_sent","User",user.id);
  res.status(201).json({needsVerification:true,email,message:`We sent a 6-digit code to ${email}. Enter it to finish creating your account.`});
}));
router.post("/auth/verify-email",otpLimiter,wrap(async(req,res)=>{
  const email=String(req.body.email||"").toLowerCase().trim();
  const user=await User.findOne({email,status:"pending_email"}).select(OTP_SEL);
  if(!user) return res.status(400).json({error:"The code is invalid or has expired. Request a new code."});
  const r=await verifyOtp(user,"signup",req.body.code); if(!r.ok) return res.status(400).json({error:r.error});
  clearOtp(user); user.status=config.requireAdminApproval?"pending_approval":"active";
  if(user.status==="active"){user.lastLoginAt=new Date();user.lastSeenAt=new Date();}
  await user.save();
  const admins=await User.find({role:"admin",status:"active"}).select("_id");
  for(const a of admins)await notify(a.id,config.requireAdminApproval?"new_account_requested":"new_patient_joined",config.requireAdminApproval?"New account request":"New patient joined",`${user.name} (${user.email}) verified their email.${config.requireAdminApproval?" Approve the account in Requests > New accounts.":""}`,"User",user.id);
  await audit(req,"patient.email_verified","User",user.id);
  if(user.status!=="active") return res.json({message:"Email verified. Your account now waits for admin approval; you will get an email once it is approved."});
  sendMailSafe(user.contactEmail||user.email,"Welcome to MedAI Hospital",`Hello ${user.name},\n\nYour MedAI Hospital account is ready. Sign in here: ${config.appPublicUrl}\n\n- MedAI Hospital`).catch(()=>{});
  res.json({token:makeToken(user),user:{id:user.id,name:user.name,email:user.email,role:user.role},message:"Email verified. Welcome to MedAI Hospital!"});
}));
router.post("/auth/resend-code",otpLimiter,wrap(async(req,res)=>{
  const email=String(req.body.email||"").toLowerCase().trim();
  const generic={message:"If a sign-up is waiting for this email, a new code was sent."};
  const user=await User.findOne({email,status:"pending_email"}).select(OTP_SEL); if(!user) return res.json(generic);
  if(user.otpSentAt&&Date.now()-user.otpSentAt.getTime()<60000) return res.status(429).json({error:"Please wait a minute before requesting another code."});
  const code=await issueOtp(user,"signup");
  await sendMailSafe(email,"Your MedAI Hospital verification code",`Hello ${user.name},\n\nYour new MedAI Hospital verification code is: ${code}\n\nIt is valid for 10 minutes.\n\n- MedAI Hospital`);
  res.json(generic);
}));

router.post("/auth/login", loginLimiter, wrap(async(req,res)=>{
  const email=String(req.body.email||"").toLowerCase().trim();
  const user=await User.findOne({email}).select("+passwordHash");
  const ok=await verifyPassword(String(req.body.password||""),user?user.passwordHash:DUMMY_HASH);
  if(!user || !ok) return res.status(401).json({error:"Invalid email or password"});
  if(user.status!=="active"){
    const msg=user.status==="pending_email"?"Please verify your email first. Enter the 6-digit code we emailed you.":user.status==="pending_approval"?"Your account request is waiting for admin approval. You will get an email once it is approved.":user.status==="pending_verification"?"Your account is pending verification":user.status==="rejected"?"Your application was not approved":"Account is unavailable";
    return res.status(403).json({error:msg,status:user.status,role:user.role,note:user.role==="doctor"?(user.doctorProfile?.verificationNote||""):""});
  }
  const token=makeToken(user);
  user.lastLoginAt=new Date(); user.lastSeenAt=new Date(); await user.save();
  await audit(req,"auth.login","User",user.id);
  res.json({token,user:{id:user.id,name:user.name,email:user.email,role:user.role}});
}));

router.get("/auth/me",auth,wrap(async(req,res)=>{
  const user=await User.findById(req.user.id).select("-passwordHash");
  res.json({user});
}));

router.post("/auth/change-password",auth,wrap(async(req,res)=>{
  const s=z.object({currentPassword:z.string(),newPassword:z.string().min(14).max(128)}).safeParse(req.body);
  if(!s.success) return res.status(400).json({error:"New password must be at least 14 characters"});
  const user=await User.findById(req.user.id).select("+passwordHash");
  if(!await verifyPassword(s.data.currentPassword,user.passwordHash)) return res.status(400).json({error:"Current password is incorrect"});
  user.passwordHash=await hashPassword(s.data.newPassword); user.passwordChangedAt=new Date(); await user.save();
  sendMailSafe(user.contactEmail||user.email,"Your MedAI Hospital password was changed",`Hello ${user.name},\n\nYour password was just changed. If this was not you, contact the MedAI admin team immediately.\n\n- MedAI Hospital`).catch(()=>{});
  await audit(req,"auth.password_changed","User",user.id);
  // Older sessions on other devices are now invalid; this device gets a fresh token.
  res.json({message:"Password changed. Other devices have been signed out.",token:makeToken(user)});
}));

router.post("/doctor/apply",applyLimiter,upload.array("documents",5),validateUploads,wrap(async(req,res)=>{
  const files=req.files||[];
  try{
    const s=z.object({name:z.string().min(2).max(120),email:z.string().email(),phone:z.string().min(5).max(30),password:z.string().min(14).max(128),bmdcNumber:z.string().min(3).max(40),specialty:z.string().min(2).max(100),qualifications:z.string().min(2).max(500),experienceYears:z.coerce.number().min(0).max(70)}).safeParse(req.body);
    if(!s.success){await removeFiles(files);return res.status(400).json({error:"Invalid doctor application. Check every field (password needs 14+ characters).",details:s.error.flatten()});}
    if(!files.some((f,i)=>String(req.body[`category_${i}`]||"")==="bmdc_certificate")){await removeFiles(files);return res.status(400).json({error:"Upload your BMDC registration certificate."});}
    if(await User.findOne({email:s.data.email.toLowerCase()})){await removeFiles(files);return res.status(409).json({error:"Email already registered"});}
    const user=await User.create({name:s.data.name,email:s.data.email.toLowerCase(),phone:s.data.phone,passwordHash:await hashPassword(s.data.password),role:"doctor",status:"pending_verification",doctorProfile:{bmdcNumber:s.data.bmdcNumber,specialty:s.data.specialty,qualifications:s.data.qualifications.split(",").map(x=>x.trim()).filter(Boolean),experienceYears:s.data.experienceYears}});
    await saveDoctorDocs(user.id,files,req.body);
    await audit(req,"doctor.application_submitted","User",user.id,{documentCount:files.length});
    res.status(201).json({message:"Application submitted. Your account stays locked until an admin verifies your documents.",doctorId:user.id,status:user.status});
  }catch(e){ await removeFiles(files); throw e; }
}));

// A doctor whose application needs more information cannot sign in yet, so they authenticate with email+password here.
router.post("/doctor/additional-documents",applyLimiter,upload.array("documents",5),validateUploads,wrap(async(req,res)=>{
  const files=req.files||[];
  try{
    const email=String(req.body.email||"").toLowerCase().trim();
    const user=await User.findOne({email,role:"doctor"}).select("+passwordHash");
    const ok=await verifyPassword(String(req.body.password||""),user?user.passwordHash:DUMMY_HASH);
    if(!user||!ok||user.status!=="pending_verification"){await removeFiles(files);return res.status(401).json({error:"Invalid credentials, or this application is not awaiting documents"});}
    if(!files.length) return res.status(400).json({error:"Attach at least one document"});
    await saveDoctorDocs(user.id,files,req.body);
    await audit(req,"doctor.additional_documents",  "User",user.id,{documentCount:files.length});
    res.status(201).json({message:"Documents received. The admin team will review them."});
  }catch(e){ await removeFiles(files); throw e; }
}));

router.get("/doctor/me",auth,allow("doctor"),wrap(async(req,res)=>{
  const files=await PrivateFile.find({ownerId:req.user.id}).select("-storedName");
  res.json({user:await User.findById(req.user.id).select("-passwordHash"),documents:files});
}));

router.patch("/doctor/profile",auth,allow("doctor"),wrap(async(req,res)=>{
  const s=z.object({phone:z.string().max(30).optional(),clinicName:z.string().max(150).optional(),bio:z.string().max(1000).optional()}).safeParse(req.body);
  if(!s.success) return res.status(400).json({error:"Invalid profile details"});
  const user=await User.findById(req.user.id);
  if(s.data.phone!==undefined) user.phone=s.data.phone;
  if(s.data.clinicName!==undefined) user.doctorProfile.clinicName=s.data.clinicName;
  if(s.data.bio!==undefined) user.doctorProfile.bio=s.data.bio;
  await user.save(); await audit(req,"doctor.profile_updated","User",user.id);
  res.json({user});
}));

// Presence heartbeat: only timestamps and role/account metadata are exposed to Admin.
router.post("/presence/heartbeat",auth,wrap(async(req,res)=>{
  await User.updateOne({_id:req.user.id,status:"active"},{$set:{lastSeenAt:new Date()}});
  res.json({ok:true,serverTime:new Date().toISOString()});
}));

router.get("/admin/monitoring",auth,allow("admin"),wrap(async(req,res)=>{
  const now=new Date(), onlineSince=new Date(now.getTime()-75_000), staleCallSince=new Date(now.getTime()-90_000);
  const [onlineUsers,activeCalls,recentActivity,onlineCounts]=await Promise.all([
    User.find({role:{$in:["patient","doctor"]},status:"active",lastSeenAt:{$gte:onlineSince}}).select("name email role lastLoginAt lastSeenAt").sort({lastSeenAt:-1}).limit(200),
    CallSession.find({status:"active",lastHeartbeatAt:{$gte:staleCallSince}}).populate("patientId","name email").populate("doctorId","name email").populate("appointmentId","status scheduledAt").sort({lastHeartbeatAt:-1}).limit(100),
    AuditEvent.find().sort({createdAt:-1}).limit(40).populate("actorId","name email role"),
    User.aggregate([{$match:{role:{$in:["patient","doctor"]},status:"active",lastSeenAt:{$gte:onlineSince}}},{$group:{_id:"$role",count:{$sum:1}}}])
  ]);
  res.json({asOf:now,onlineUsers,activeCalls,recentActivity,onlineCounts,thresholdSeconds:75,callStaleSeconds:90});
}));

router.get("/admin/overview",auth,allow("admin"),wrap(async(req,res)=>{
  const [patients,doctors,pendingDoctors,appointments,reports]=await Promise.all([
    User.countDocuments({role:"patient"}),User.countDocuments({role:"doctor"}),User.countDocuments({role:"doctor",status:"pending_verification"}),
    Appointment.countDocuments(),PrivateFile.countDocuments({category:"patient_report"})
  ]);
  res.json({patients,doctors,pendingDoctors,appointments,uploadedReports:reports});
}));

router.get("/admin/system/errors",auth,allow("admin"),wrap(async(req,res)=>{
  const limit=Math.min(200,Math.max(1,Number(req.query.limit)||50));
  const filter=req.query.resolved==="true"?{resolvedAt:{$ne:null}}:req.query.resolved==="false"?{resolvedAt:null}:{};
  const errors=await SystemError.find(filter).populate("actorId","name email role").sort({createdAt:-1}).limit(limit);
  res.json({errors});
}));
router.post("/admin/system/errors/:id/resolve",auth,allow("admin"),wrap(async(req,res)=>{
  const error=await SystemError.findByIdAndUpdate(req.params.id,{$set:{resolvedAt:new Date(),resolvedBy:req.user.id}},{new:true});
  if(!error)return res.status(404).json({error:"System error not found"});
  await audit(req,"system_error.resolved","SystemError",error.id);res.json({error});
}));

router.get("/admin/doctors/pending",auth,allow("admin"),wrap(async(req,res)=>{
  const doctors=await User.find({role:"doctor",status:"pending_verification"}).select("name email phone doctorProfile createdAt");
  const result=await Promise.all(doctors.map(async d=>({doctor:d,documents:await PrivateFile.find({ownerId:d.id}).select("category originalName mimeType size createdAt")})));
  res.json({applications:result});
}));

router.post("/admin/doctors/:id/decision",auth,allow("admin"),wrap(async(req,res)=>{
  const s=z.object({decision:z.enum(["approve","reject","request_info"]),note:z.string().max(1000).optional()}).safeParse(req.body);
  if(!s.success) return res.status(400).json({error:"Invalid decision"});
  const doctor=await User.findOne({_id:req.params.id,role:"doctor"});
  if(!doctor) return res.status(404).json({error:"Doctor not found"});
  if(s.data.decision==="approve"){doctor.status="active";doctor.doctorProfile.verifiedAt=new Date();}
  if(s.data.decision==="reject"){doctor.status="rejected";doctor.doctorProfile.verificationNote=s.data.note||"Application rejected";}
  if(s.data.decision==="request_info"){doctor.status="pending_verification";doctor.doctorProfile.verificationNote=s.data.note||"Additional information requested";}
  await doctor.save(); await audit(req,`doctor.${s.data.decision}`,"User",doctor.id,{note:s.data.note||""});
  {const to=doctor.contactEmail||doctor.email;const d=s.data.decision;sendMailSafe(to,d==="approve"?"Your MedAI doctor account is approved":d==="reject"?"Your MedAI doctor application":"MedAI needs more information",d==="approve"?`Hello Dr. ${doctor.name},\n\nYour doctor account is approved. Sign in: ${config.appPublicUrl}\n\n- MedAI Hospital`:d==="reject"?`Hello ${doctor.name},\n\nYour application was not approved.${s.data.note?"\nNote: "+s.data.note:""}\n\n- MedAI Hospital`:`Hello ${doctor.name},\n\nThe admin team needs more information.${s.data.note?"\nNote: "+s.data.note:""}\nOpen ${config.appPublicUrl} and use "Send requested documents".\n\n- MedAI Hospital`).catch(()=>{});}
  res.json({message:"Decision saved",status:doctor.status});
}));

router.get("/profile",auth,wrap(async(req,res)=>{
  const user=await User.findById(req.user.id).select("-passwordHash"); res.json({user});
}));
router.patch("/profile",auth,allow("patient"),wrap(async(req,res)=>{
  const em=z.object({name:z.string().max(120).optional(),phone:z.string().max(30).optional(),relationship:z.string().max(60).optional()});
  const s=z.object({name:z.string().min(2).max(120).optional(),phone:z.string().max(30).optional(),dateOfBirth:z.string().max(40).optional(),address:z.string().max(300).optional(),gender:z.string().max(30).optional(),bloodGroup:z.string().max(10).optional(),allergies:z.array(z.string().max(100)).max(50).optional(),currentMedicines:z.array(z.string().max(120)).max(50).optional(),medicalHistory:z.string().max(5000).optional(),emergencyContact:em.optional()}).safeParse(req.body);
  if(!s.success) return res.status(400).json({error:"Invalid profile details",details:s.error.flatten()});
  const update={...s.data};
  if("dateOfBirth" in update){
    if(update.dateOfBirth){const d=new Date(update.dateOfBirth); if(Number.isNaN(d.getTime())||d>new Date()) return res.status(400).json({error:"Invalid date of birth"}); update.dateOfBirth=d;} else update.dateOfBirth=null;
  }
  const user=await User.findByIdAndUpdate(req.user.id,{$set:update},{new:true,runValidators:true}).select("-passwordHash");
  await audit(req,"patient.profile_updated","User",user.id); res.json({user});
}));
router.post("/files/upload",auth,upload.single("file"),validateUploads,wrap(async(req,res)=>{
  if(!req.file) return res.status(400).json({error:"File is required"});
  const category=String(req.body.category||"patient_report");
  const allowed=req.user.role==="patient"?["patient_report","other"]:["other","other_qualification"];
  if(!allowed.includes(category)){return res.status(400).json({error:"Invalid file category"});}
  const record=await storeBuffer({ownerId:req.user.id,uploadedBy:req.user.id,category,originalName:req.file.originalname,mimeType:req.file.mimetype,buffer:req.file.buffer});
  await audit(req,"file.uploaded","PrivateFile",record.id,{category});
  res.status(201).json({file:{id:record.id,category:record.category,originalName:record.originalName,size:record.size,createdAt:record.createdAt}});
}));
router.get("/files/mine",auth,wrap(async(req,res)=>{
  const files=await PrivateFile.find({ownerId:req.user.id}).select("-storedName"); res.json({files});
}));
router.get("/files/:id/download",auth,wrap(async(req,res)=>{
  const file=await PrivateFile.findById(req.params.id);
  if(!file) return res.status(404).json({error:"File not found"});
  let permitted=String(file.ownerId)===String(req.user.id);
  let accessAction="";
  // Admins may open doctor documents and (audit-logged) patient reports, AI PDFs and doctor-approved PDFs.
  if(!permitted && req.user.role==="admin" && ["doctor_photo","bmdc_certificate","degree_certificate","identity_document","other_qualification","other"].includes(file.category)){permitted=true;accessAction="admin.private_file_access";}
  if(!permitted && file.category==="consultation_recording" && ["doctor","patient"].includes(req.user.role)){
    permitted=!!(await Appointment.exists({_id:file.originalName.match(/consultation-([a-f0-9]{24})-/i)?.[1],$or:[{patientId:req.user.id},{doctorId:req.user.id}]}));
    if(permitted) accessAction="call.recording_access";
  }
  if(!permitted && req.user.role==="admin" && ["patient_report","report_ai_pdf","report_final_pdf"].includes(file.category)){permitted=true;accessAction="admin.report_file_access";}
  if(!permitted && req.user.role==="doctor" && file.category==="patient_report"){
    permitted=!!(await MedicalReport.exists({originalFileId:file._id,doctorId:req.user.id}));
    if(permitted) accessAction="doctor.assigned_report_file_access";
  }
  if(!permitted && req.user.role==="doctor" && file.category==="patient_report"){
    permitted=!!(await Appointment.exists({doctorId:req.user.id,patientId:file.ownerId,status:{$in:DOCTOR_ACCESS_STATUSES}}));
    if(permitted) accessAction="doctor.patient_file_access";
  }
  if(!permitted && ["report_ai_pdf","report_final_pdf"].includes(file.category)){
    const report=await MedicalReport.findOne({$or:[{aiPdfFileId:file._id},{finalPdfFileId:file._id}]});
    permitted=!!report && (String(report.patientId)===String(req.user.id) || (req.user.role==="doctor" && String(report.doctorId)===String(req.user.id)));
    if(permitted) accessAction="medical_report.pdf_access";
  }
  if(!permitted) return res.status(403).json({error:"Access denied"});
  if(accessAction) await audit(req,accessAction,"PrivateFile",file.id);
  const downloadPath=await resolveStoredFilePath(uploadDir,file);
  res.download(downloadPath,file.originalName,()=>{if(file.storageProvider==="gridfs") fs.unlink(downloadPath).catch(()=>{});});
}));
router.delete("/files/:id",auth,wrap(async(req,res)=>{
  const file=await PrivateFile.findOne({_id:req.params.id,ownerId:req.user.id,category:{$in:["patient_report","other"]}});
  if(!file) return res.status(404).json({error:"File not found"});
  if(file.storageProvider==="gridfs") await deleteGridFSFile(file.storedName); else {try{await fs.unlink(path.join(uploadDir,file.storedName));}catch{}}
  await file.deleteOne(); await audit(req,"file.deleted","PrivateFile",file.id);
  res.json({message:"File deleted"});
}));

router.post("/appointments",auth,allow("patient"),wrap(async(req,res)=>{
  const s=z.object({problem:z.string().min(5).max(4000),doctorId:z.string().optional(),consultationType:z.enum(["online","in_person"]).default("online"),preferredAt:z.string().datetime().optional()}).safeParse(req.body);
  if(!s.success) return res.status(400).json({error:"Please describe the reason for appointment"});
  let preferredAt=null;
  if(s.data.preferredAt){if(!s.data.doctorId)return res.status(400).json({error:"Choose a doctor to pick a time slot"});const pd=await User.findOne({_id:s.data.doctorId,role:"doctor",status:"active"});if(!pd)return res.status(400).json({error:"Selected doctor is unavailable"});const why=await slotIsFree(pd,new Date(s.data.preferredAt));if(why)return res.status(409).json({error:why});preferredAt=new Date(s.data.preferredAt);}
  if(s.data.doctorId && !await User.findOne({_id:s.data.doctorId,role:"doctor",status:"active"})) return res.status(400).json({error:"Selected doctor is unavailable"});
  const appt=await Appointment.create({patientId:req.user.id,doctorId:s.data.doctorId||null,problem:s.data.problem,consultationType:s.data.consultationType,preferredAt});
  await audit(req,"appointment.requested","Appointment",appt.id);
  if(appt.doctorId) await notify(appt.doctorId,"appointment_requested","New appointment request",`${req.user.name} requested an appointment${appt.preferredAt?" for "+appt.preferredAt.toISOString():""}. Open New requests to respond.`,"Appointment",appt.id);
  res.status(201).json({appointment:appt});
}));
router.get("/appointments",auth,wrap(async(req,res)=>{
  const filter=req.user.role==="patient"?{patientId:req.user.id}:req.user.role==="doctor"?{doctorId:req.user.id}:{};
  const appointments=await Appointment.find(filter).populate("patientId","name email phone").populate("doctorId","name doctorProfile.specialty").sort({createdAt:-1});
  res.json({appointments});
}));
router.patch("/appointments/:id",auth,allow("doctor","admin"),wrap(async(req,res)=>{
  const s=z.object({status:z.enum(["awaiting_records","awaiting_tests","confirmed","waiting_room","in_progress","completed","cancelled","rejected","follow_up_required"]),scheduledAt:z.string().datetime().optional(),clinicianNote:z.string().max(3000).optional()}).safeParse(req.body);
  if(!s.success) return res.status(400).json({error:"Invalid appointment update"});
  const appt=await Appointment.findById(req.params.id); if(!appt) return res.status(404).json({error:"Appointment not found"});
  if(req.user.role==="doctor" && String(appt.doctorId)!==String(req.user.id)) return res.status(403).json({error:"Not assigned to this appointment"});
  if(CLOSED_STATUSES.includes(appt.status) && req.user.role!=="admin") return res.status(409).json({error:"This appointment is already closed"});
  if(s.data.status==="confirmed" && !s.data.scheduledAt) return res.status(400).json({error:"A confirmed appointment needs a scheduled date/time"});
  if(s.data.status==="confirmed" && !appt.doctorId) return res.status(400).json({error:"Assign a doctor before confirming"});
  if(s.data.scheduledAt && new Date(s.data.scheduledAt)<=new Date()) return res.status(400).json({error:"Scheduled time must be in the future"});
  if(s.data.status==="confirmed"&&s.data.scheduledAt&&req.user.role==="doctor"){
    const doctor=await User.findById(req.user.id);const when=new Date(s.data.scheduledAt);
    const slots=doctor.doctorProfile?.availabilitySlots||[];
    if(slots.length&&!inAvailability(doctor,when))return res.status(409).json({error:"The selected time is outside your published availability"});
    const blocked=(doctor.doctorProfile?.unavailablePeriods||[]).some(x=>when>=x.start&&when<=x.end);
    if(blocked)return res.status(409).json({error:"You marked this period as unavailable"});
  }
  Object.assign(appt,s.data); if(s.data.scheduledAt) appt.scheduledAt=new Date(s.data.scheduledAt);
  try { await appt.save(); } catch(err) { if(err?.code===11000) return res.status(409).json({error:"This doctor already has an appointment at that time. Choose another slot."}); throw err; }
  await audit(req,"appointment.updated","Appointment",appt.id,{status:appt.status});
  await notify(appt.patientId,"appointment_status_changed","Appointment update",`Your appointment is now: ${appt.status.replace(/_/g," ")}${appt.scheduledAt?" - "+appt.scheduledAt.toISOString():""}.`,"Appointment",appt.id);
  res.json({appointment:appt});
}));
router.post("/appointments/:id/cancel",auth,allow("patient"),wrap(async(req,res)=>{
  const appt=await Appointment.findOneAndUpdate({_id:req.params.id,patientId:req.user.id,status:{$in:["requested","awaiting_records","awaiting_tests","confirmed","follow_up_required"]}},{$set:{status:"cancelled"}},{new:true});
  if(!appt) return res.status(409).json({error:"This appointment can no longer be cancelled"});
  await audit(req,"appointment.cancelled_by_patient","Appointment",appt.id);
  if(appt.doctorId) await notify(appt.doctorId,"appointment_cancelled","Appointment cancelled","A patient cancelled an appointment with you.","Appointment",appt.id);
  res.json({appointment:appt});
}));
router.get("/appointments/:id/patient-record",auth,allow("doctor"),wrap(async(req,res)=>{
  const appt=await Appointment.findOne({_id:req.params.id,doctorId:req.user.id,status:{$in:DOCTOR_ACCESS_STATUSES}});
  if(!appt) return res.status(403).json({error:"Record is available only for your active appointments"});
  const patient=await User.findById(appt.patientId).select("name phone dateOfBirth gender bloodGroup allergies currentMedicines medicalHistory emergencyContact");
  const files=await PrivateFile.find({ownerId:appt.patientId,category:"patient_report"}).select("originalName mimeType size createdAt").sort({createdAt:-1});
  await audit(req,"doctor.patient_record_viewed","Appointment",appt.id);
  res.json({patient,files});
}));

router.get("/appointments/:id/messages",auth,wrap(async(req,res)=>{
  const appt=await Appointment.findById(req.params.id); if(!appt) return res.status(404).json({error:"Appointment not found"});
  const allowed=String(appt.patientId)===String(req.user.id)||String(appt.doctorId)===String(req.user.id);
  if(!allowed) return res.status(403).json({error:"Only participants can access this conversation"});
  res.json({messages:await Message.find({appointmentId:appt.id}).populate("senderId","name role").sort({createdAt:1})});
}));
router.post("/appointments/:id/messages",auth,wrap(async(req,res)=>{
  const appt=await Appointment.findById(req.params.id); if(!appt) return res.status(404).json({error:"Appointment not found"});
  const allowed=String(appt.patientId)===String(req.user.id)||String(appt.doctorId)===String(req.user.id);
  if(!allowed || !appt.doctorId) return res.status(403).json({error:"Conversation is not available"});
  const body=String(req.body.body||"").trim(); if(!body||body.length>5000) return res.status(400).json({error:"Message must be 1-5000 characters"});
  const message=await Message.create({appointmentId:appt.id,senderId:req.user.id,body});
  res.status(201).json({message});
}));

const reportFileUpload = multer({storage:multer.memoryStorage(),limits:{fileSize:12*1024*1024,files:1},fileFilter:(_req,file,cb)=>{
  const ok=["application/pdf","image/jpeg","image/png","image/webp"].includes(file.mimetype);
  cb(ok?null:new Error("Upload a PDF, JPG, PNG or WEBP report"),ok);
}});
router.post("/ai/report-file-analysis",auth,allow("patient"),reportFileUpload.single("file"),aiLimiter,wrap(async(req,res)=>{
  if(!req.file) return res.status(400).json({error:"Choose a PDF or image report first"});
  if(!config.openRouterKey) return res.status(503).json({error:"AI provider is not configured"});
  let extracted="";
  try {
    if(req.file.mimetype==="application/pdf") {
      const pdfModule=await import("pdf-parse");
      const parsePdf=pdfModule.default;
      const parsed=await parsePdf(req.file.buffer);
      extracted=String(parsed.text||"").trim();
    } else {
      // OCR is retained as a cross-check; the image is also sent to a vision-capable model.
      const {createWorker}=await import("tesseract.js");
      const worker=await createWorker("eng+ben");
      try { const result=await worker.recognize(req.file.buffer); extracted=String(result.data?.text||"").trim(); }
      finally { await worker.terminate(); }
    }
  } catch(e) {
    if(req.file.mimetype==="application/pdf") return res.status(422).json({error:"Could not extract text from this PDF. Try a text-based PDF or paste the report text manually."});
    // Vision analysis can still proceed if OCR fails for a supported image.
  }
  if(req.file.mimetype==="application/pdf" && extracted.length<20) return res.status(422).json({error:"No readable text was found in this PDF. Scanned PDF page OCR is not yet supported; upload a clear JPG/PNG or paste the report text."});
  if(extracted.length>12000) extracted=extracted.slice(0,12000);
  const system="You are a cautious medical-report explanation assistant. Extract only clearly visible test names, values, units and reference ranges. Preserve exact numbers and flag unreadable or uncertain text; never guess or silently correct OCR. Explain the report in plain language, separate observed results from general context, do not diagnose or prescribe, and do not infer missing values. If a result may be urgent, advise prompt contact with a qualified clinician without asserting a diagnosis. Do not repeat patient names, addresses, IDs or other identifiers. End by recommending clinician review.";
  const userContent=req.file.mimetype==="application/pdf"
    ? `Analyze this extracted PDF report text. Treat OCR/text uncertainty explicitly.\n\n${extracted}`
    : [{type:"text",text:`Analyze this medical report image directly. OCR cross-check (may be inaccurate):\n${extracted||"No usable OCR text was extracted."}\nRead visible content carefully; do not guess unclear numbers.`},{type:"image_url",image_url:{url:`data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`}}];
  const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${config.openRouterKey}`,"Content-Type":"application/json","HTTP-Referer":config.clientOrigin,"X-Title":"MedAI Hospital"},body:JSON.stringify({model:config.openRouterModel,messages:[{role:"system",content:system},{role:"user",content:userContent}],temperature:0.1})});
  if(!response.ok) return res.status(502).json({error:"AI provider request failed. Confirm that the configured OpenRouter model supports image input for image reports."});
  const data=await response.json(); const answer=data.choices?.[0]?.message?.content;
  if(!answer) return res.status(502).json({error:"AI response was empty"});
  await audit(req,"ai.report_file_analyzed","User",req.user.id,{mimeType:req.file.mimetype,extractedCharacters:extracted.length,vision:req.file.mimetype!=="application/pdf"});
  res.json({answer,extractedText:extracted,analysisMode:req.file.mimetype==="application/pdf"?"pdf_text":"image_vision_plus_ocr",disclaimer:"AI explanation only—not a diagnosis or prescription. OCR/vision may misread values. Check every value against the original and ask a qualified clinician to review it. The uploaded report content was sent to the configured AI provider."});
}));

router.post("/ai/report-analysis",auth,allow("patient"),aiLimiter,wrap(async(req,res)=>{
  if(!config.openRouterKey) return res.status(503).json({error:"AI provider is not configured"});
  const reportText=String(req.body.reportText||"").trim();
  if(reportText.length<20||reportText.length>12000) return res.status(400).json({error:"Paste report text between 20 and 12000 characters"});
  const system="You are a cautious medical-report explanation assistant. Explain only what the pasted report text says in plain language. Separate stated results from general context; do not diagnose, prescribe, change medication, or infer values missing from the text. Flag that units, reference ranges, age/sex context and lab methods matter. If a value appears potentially urgent, advise prompt contact with a qualified clinician without asserting a diagnosis. End by recommending review with the ordering clinician. Treat the text as potentially sensitive and do not repeat names or identifiers.";
  const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${config.openRouterKey}`,"Content-Type":"application/json","HTTP-Referer":config.clientOrigin,"X-Title":"MedAI Hospital"},body:JSON.stringify({model:config.openRouterModel,messages:[{role:"system",content:system},{role:"user",content:reportText}],temperature:0.1})});
  if(!response.ok) return res.status(502).json({error:"AI provider request failed"}); const data=await response.json(); const answer=data.choices?.[0]?.message?.content; if(!answer) return res.status(502).json({error:"AI response was empty"});
  await audit(req,"ai.report_text_analyzed","User",req.user.id,{characters:reportText.length}); res.json({answer,disclaimer:"AI explanation only—not a diagnosis. This feature does not read the uploaded PDF/image automatically; paste text carefully and have the ordering clinician review it."});
}));

// WebRTC signaling and consent-controlled consultation recording. Signals expire after 24 hours.
async function getCallParticipant(id,user){
  const appt=await Appointment.findById(id); if(!appt) return {error:"Appointment not found"};
  if(String(appt.patientId)!==String(user.id)&&String(appt.doctorId)!==String(user.id)) return {error:"Only the appointment participants can access calls"};
  if(!appt.doctorId) return {error:"A doctor must be assigned before starting a call"};
  if(appt.consultationType!=="online") return {error:"Audio/video calls are only available for online appointments"};
  if(CLOSED_STATUSES.includes(appt.status)) return {error:"This appointment is closed"};
  return {appt};
}
router.get("/appointments/:id/call-state",auth,wrap(async(req,res)=>{
  const r=await getCallParticipant(req.params.id,req.user); if(r.error) return res.status(403).json({error:r.error});
  res.json({consent:{patient:!!r.appt.recordingConsent?.patientAt,doctor:!!r.appt.recordingConsent?.doctorAt},role:req.user.role});
}));
router.post("/appointments/:id/call-heartbeat",auth,wrap(async(req,res)=>{
  const r=await getCallParticipant(req.params.id,req.user); if(r.error) return res.status(403).json({error:r.error});
  const active=req.body.active===true;
  if(active){
    const filter={appointmentId:r.appt.id,status:"active"};
    await CallSession.findOneAndUpdate(filter,{$set:{patientId:r.appt.patientId,doctorId:r.appt.doctorId,lastHeartbeatAt:new Date(),lastConnectionState:["starting","connected","disconnected","failed"].includes(req.body.connectionState)?req.body.connectionState:"starting"},$setOnInsert:{startedAt:new Date()}},{upsert:true,new:true});
  } else { await CallSession.updateMany({appointmentId:r.appt.id,status:"active"},{$set:{status:"ended",endedAt:new Date(),lastHeartbeatAt:new Date(),lastConnectionState:"ended"}}); }
  await User.updateOne({_id:req.user.id},{$set:{lastSeenAt:new Date()}});
  res.json({ok:true});
}));
router.post("/appointments/:id/recording-consent",auth,wrap(async(req,res)=>{
  const r=await getCallParticipant(req.params.id,req.user); if(r.error) return res.status(403).json({error:r.error});
  const accepted=req.body.accepted===true; const field=req.user.role==="patient"?"recordingConsent.patientAt":"recordingConsent.doctorAt";
  await Appointment.updateOne({_id:r.appt.id},{$set:{[field]:accepted?new Date():null}});
  await audit(req,accepted?"call.recording_consent_granted":"call.recording_consent_withdrawn","Appointment",r.appt.id,{role:req.user.role});
  const fresh=await Appointment.findById(r.appt.id); res.json({consent:{patient:!!fresh.recordingConsent?.patientAt,doctor:!!fresh.recordingConsent?.doctorAt}});
}));
router.get("/appointments/:id/call-signals",auth,wrap(async(req,res)=>{
  const r=await getCallParticipant(req.params.id,req.user); if(r.error) return res.status(403).json({error:r.error});
  const after=req.query.after?new Date(String(req.query.after)):new Date(Date.now()-60000);
  const signals=await CallSignal.find({appointmentId:r.appt.id,createdAt:{$gt:Number.isNaN(after.getTime())?new Date(Date.now()-60000):after},senderId:{$ne:req.user.id}}).sort({createdAt:1}).limit(100).select("type payload senderId createdAt");
  res.json({signals});
}));
router.post("/appointments/:id/call-signals",auth,wrap(async(req,res)=>{
  const r=await getCallParticipant(req.params.id,req.user); if(r.error) return res.status(403).json({error:r.error});
  const type=String(req.body.type||""); if(!["offer","answer","ice","hangup"].includes(type)) return res.status(400).json({error:"Invalid call signal"});
  const payload=req.body.payload; if(type!=="hangup"&&(payload==null||JSON.stringify(payload).length>100000)) return res.status(400).json({error:"Call signal payload is missing or too large"});
  const signal=await CallSignal.create({appointmentId:r.appt.id,senderId:req.user.id,type,payload:type==="hangup"?{}:payload});
  if(type==="offer") await CallSession.findOneAndUpdate({appointmentId:r.appt.id,status:"active"},{$set:{patientId:r.appt.patientId,doctorId:r.appt.doctorId,lastHeartbeatAt:new Date(),lastConnectionState:"starting"},$setOnInsert:{startedAt:new Date()}},{upsert:true,new:true});
  if(type==="hangup") await CallSession.updateMany({appointmentId:r.appt.id,status:"active"},{$set:{status:"ended",endedAt:new Date(),lastHeartbeatAt:new Date(),lastConnectionState:"ended"}});
  await User.updateOne({_id:req.user.id},{$set:{lastSeenAt:new Date()}});
  res.status(201).json({id:signal.id,createdAt:signal.createdAt});
}));
router.get("/appointments/:id/recordings",auth,wrap(async(req,res)=>{
  const r=await getCallParticipant(req.params.id,req.user); if(r.error) return res.status(403).json({error:r.error});
  const files=await PrivateFile.find({ownerId:r.appt.patientId,category:"consultation_recording",originalName:new RegExp("^consultation-"+String(r.appt.id)+"-")}).select("originalName mimeType size createdAt").sort({createdAt:-1});
  res.json({recordings:files});
}));
router.post("/appointments/:id/recording",auth,recordingUpload.single("file"),wrap(async(req,res)=>{
  const r=await getCallParticipant(req.params.id,req.user); if(r.error){return res.status(403).json({error:r.error});}
  if(!r.appt.recordingConsent?.patientAt||!r.appt.recordingConsent?.doctorAt){return res.status(403).json({error:"Both patient and doctor must consent before recording can be saved"});}
  if(!req.file) return res.status(400).json({error:"Recording file is required"});
  const file=await storeBuffer({ownerId:r.appt.patientId,uploadedBy:req.user.id,category:"consultation_recording",originalName:`consultation-${r.appt.id}-${Date.now()}${EXT_BY_MIME[req.file.mimetype]||".webm"}`,mimeType:req.file.mimetype,buffer:req.file.buffer});
  await audit(req,"call.recording_saved","Appointment",r.appt.id,{fileId:file.id,size:file.size});
  res.status(201).json({message:"Audio recording saved privately",file:{id:file.id,originalName:file.originalName,size:file.size}});
}));
router.post("/appointments/:id/recording-analysis",auth,aiLimiter,wrap(async(req,res)=>{
  const r=await getCallParticipant(req.params.id,req.user); if(r.error) return res.status(403).json({error:r.error});
  if(!r.appt.recordingConsent?.patientAt||!r.appt.recordingConsent?.doctorAt) return res.status(403).json({error:"Both participants must consent before analysis"});
  if(!config.openRouterKey) return res.status(503).json({error:"AI provider is not configured"});
  const transcript=String(req.body.transcript||"").trim(); if(transcript.length<20||transcript.length>12000) return res.status(400).json({error:"Provide a transcript between 20 and 12000 characters. Browser speech recognition or manual transcript can be used."});
  const system="You are a clinical documentation assistant, not a diagnosing or prescribing system. Summarize the supplied clinician-patient conversation into: 1) patient-reported symptoms and timeline, 2) relevant history/allergies/medicines explicitly mentioned, 3) clinician advice or plan explicitly stated, 4) follow-up questions or missing information, 5) urgent red flags mentioned. Distinguish patient statements from clinician statements. Never invent findings, diagnosis, or treatment. Mark uncertainty and say a licensed clinician must review. Do not make medication recommendations.";
  const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${config.openRouterKey}`,"Content-Type":"application/json","HTTP-Referer":config.clientOrigin,"X-Title":"MedAI Hospital"},body:JSON.stringify({model:config.openRouterModel,messages:[{role:"system",content:system},{role:"user",content:transcript}],temperature:0.1})});
  if(!response.ok) return res.status(502).json({error:"AI provider request failed"}); const data=await response.json(); const summary=data.choices?.[0]?.message?.content; if(!summary) return res.status(502).json({error:"AI response was empty"});
  await audit(req,"call.transcript_analyzed","Appointment",r.appt.id,{transcriptLength:transcript.length}); res.json({summary,disclaimer:"AI-generated draft for clinician review only. It is not a diagnosis, prescription, or verified medical record. Avoid sharing identifying details."});
}));

router.get("/doctors",wrap(async(_req,res)=>{
  const doctors=await User.find({role:"doctor",status:"active"}).select("name doctorProfile.specialty doctorProfile.qualifications doctorProfile.experienceYears doctorProfile.bio");
  res.json({doctors});
}));

router.get("/medicines",auth,allow("patient","doctor","admin"),wrap(async(req,res)=>{
  const q=String(req.query.q||"").trim();
  if(q.length<2) return res.json({medicines:[],message:"Enter at least two letters"});
  if(q.length>60) return res.status(400).json({error:"Search text is too long"});
  const rx=new RegExp(escapeRegex(q),"i");
  const medicines=await Medicine.find({active:true,reviewStatus:"verified",$or:[{brand:rx},{generic:rx}]}).limit(20).select("brand generic strength form manufacturer country verifiedAt uses benefits sideEffects precautions interactions whenToTake");
  res.json({medicines,notice:"Catalogue may be incomplete. Verify medicine information with a qualified pharmacist or clinician."});
}));

router.post("/ai/health-information",auth,aiLimiter,wrap(async(req,res)=>{
  const question=String(req.body.question||"").trim();
  if(question.length<2||question.length>6000) return res.status(400).json({error:"Message must be 2-6000 characters"});
  // Rule-based safety screen runs before any AI text.
  const safety=checkRedFlags(question);
  if(safety.level==="emergency"){
    await audit(req,"ai.red_flag_emergency","User",req.user.id,{flags:safety.flags.map(f=>f.id)});
    return res.json({level:"emergency",flags:safety.flags,answer:`⚠️ ${safety.flags.map(f=>f.message).join(", ")}.\n\n${safety.action}\n\nBangladesh emergency number: ${safety.emergencyNumber}.`,disclaimer:"Rule-based safety alert. This is not a diagnosis."});
  }
  if(!config.openRouterKey) return res.status(503).json({error:"AI provider is not configured"});
  const history=(Array.isArray(req.body.history)?req.body.history:[]).slice(-8).filter(m=>m&&["user","assistant"].includes(m.role)).map(m=>({role:m.role,content:String(m.content||"").slice(0,2000)}));
  const system="You are MedAI, the friendly health assistant of MedAI Hospital in Bangladesh. Reply in the same language the user writes in (Bangla, English or Banglish written in English letters, answer in Bangla or English). Be warm, clear and short (under 180 words unless asked for more); use simple words and short bullet points when helpful. Give general educational information only: do not diagnose, do not give medicine doses, do not tell the person to start, stop or change a prescription. If the user asks about a medicine, explain what it is generally used for, common cautions and when to ask a pharmacist or doctor; remind them that allergies, pregnancy, age and other medicines matter and a doctor must decide. For possible emergencies tell them to call 999. When useful, suggest booking an appointment in MedAI or uploading a lab report here with the + button. Never ask for names, phone numbers or other identifying details.";
  const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${config.openRouterKey}`,"Content-Type":"application/json","HTTP-Referer":config.clientOrigin,"X-Title":"MedAI Hospital"},body:JSON.stringify({model:config.openRouterModel,messages:[{role:"system",content:system},...history,{role:"user",content:question}],temperature:0.3,max_tokens:700})});
  if(!response.ok) return res.status(502).json({error:"AI provider request failed. Please try again."});
  const data=await response.json(); let answer=data.choices?.[0]?.message?.content;
  if(!answer) return res.status(502).json({error:"AI response was empty"});
  if(safety.level==="urgent") answer=`⚠️ ${safety.action}\n\n${answer}`;
  res.json({level:safety.level,flags:safety.flags,answer,disclaimer:"Informational only. Not a diagnosis or prescription."});
}));

// Doctor-only: catalogue-grounded medicine ideas. The doctor decides; doses are never suggested here.
router.post("/ai/medicine-suggestions",auth,allow("doctor"),aiLimiter,wrap(async(req,res)=>{
  if(!config.openRouterKey) return res.status(503).json({error:"AI provider is not configured"});
  const diagnosis=String(req.body.diagnosis||"").trim();
  if(diagnosis.length<3||diagnosis.length>600) return res.status(400).json({error:"Describe the diagnosis or problem in 3-600 characters"});
  const appt=await Appointment.findOne({_id:req.body.appointmentId,doctorId:req.user.id,status:{$in:PRESCRIBE_STATUSES}});
  if(!appt) return res.status(403).json({error:"Open one of your active appointments first"});
  const patient=await User.findById(appt.patientId).select("dateOfBirth gender allergies currentMedicines");
  const allergies=(patient?.allergies||[]).map(x=>String(x).toLowerCase()),current=(patient?.currentMedicines||[]).map(x=>String(x).toLowerCase());
  const ctx={diagnosis,ageYears:ageFromDob(patient?.dateOfBirth),sex:normSex(patient?.gender),allergies:patient?.allergies||[],currentMedicines:patient?.currentMedicines||[]};
  const system='You assist a licensed Bangladeshi doctor. Suggest up to 5 commonly used GENERIC (INN) medicines for the stated problem as options the doctor may consider. Reply ONLY with JSON: {"suggestions":[{"generic":"","class":"","reason":"one short sentence","cautions":"key cautions, incl. conflict with the patient allergies or current medicines if any"}]}. Never give doses, durations or brand names. Never claim certainty; the doctor decides. Skip any medicine that matches a listed allergy.';
  const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${config.openRouterKey}`,"Content-Type":"application/json","HTTP-Referer":config.clientOrigin,"X-Title":"MedAI Hospital"},body:JSON.stringify({model:config.openRouterModel,messages:[{role:"system",content:system},{role:"user",content:JSON.stringify(ctx)}],temperature:0.2,max_tokens:900})});
  if(!response.ok) return res.status(502).json({error:"AI provider request failed"});
  const data=await response.json(); const raw=String(data.choices?.[0]?.message?.content||"");
  let list=[]; try{list=JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]||"{}").suggestions||[];}catch{list=[];}
  const out=[];
  for(const x of list.slice(0,5)){
    const generic=String(x.generic||"").trim().slice(0,80); if(generic.length<3) continue;
    const brands=await Medicine.find({active:true,reviewStatus:"verified",generic:new RegExp(escapeRegex(generic.split(/[ ,(]/)[0]),"i")}).limit(6).select("brand generic strength form manufacturer");
    const lower=generic.toLowerCase();
    out.push({generic,class:String(x.class||"").slice(0,80),reason:String(x.reason||"").slice(0,240),cautions:String(x.cautions||"").slice(0,300),
      allergyConflict:allergies.some(a=>a&&(lower.includes(a)||a.includes(lower))),
      alreadyTaking:current.some(c=>c&&(c.includes(lower)||lower.includes(c))),brands});
  }
  await audit(req,"ai.medicine_suggestions","Appointment",appt.id,{count:out.length});
  res.json({suggestions:out,disclaimer:"AI suggestions are options for the treating doctor only, not a prescription. Check the patient's history, allergies and current medicines yourself, and enter doses yourself."});
}));

router.get("/admin/audit",auth,allow("admin"),wrap(async(req,res)=>{
  const events=await AuditEvent.find().sort({createdAt:-1}).limit(100).populate("actorId","name email role");
  res.json({events});
}));


// Admin access uses the normal email/ID + password login. MFA/OTP is intentionally disabled.

// --- Email password reset ---
let _transport=null;
function mailer(){
  if(!config.smtpHost||!config.smtpUser||!config.smtpPass) return null;
  if(!_transport) _transport=nodemailer.createTransport({host:config.smtpHost,port:config.smtpPort,secure:config.smtpSecure,auth:{user:config.smtpUser,pass:config.smtpPass}});
  return _transport;
}
// Never throws: returns true when the mail was handed to the SMTP server.
async function sendMailSafe(to,subject,text,html){
  const t=mailer(); if(!t||!to) return false;
  try{await t.sendMail({from:config.smtpFrom,to,subject,text,...(html?{html}:{})});return true;}
  catch(e){console.error("[mail] failed:",e.message);return false;}
}
const escHtml=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
// Branded HTML email (works without remote images, so it is never blocked).
function brandedEmail({title,intro,code,buttonText,link,footer}){
  return `<div style="background:#f4f8fb;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#102e49"><div style="max-width:520px;margin:auto;background:#fff;border:1px solid #dce8ef;border-radius:16px;overflow:hidden"><div style="background:linear-gradient(120deg,#087fbd,#20a58a);padding:18px 24px;color:#fff;font-size:22px;font-weight:700">MedAI <span style="font-weight:400">Hospital</span></div><div style="padding:24px"><h2 style="margin:0 0 12px;font-size:20px">${escHtml(title)}</h2><p style="line-height:1.6;color:#44607a">${intro}</p>${code?`<p style="font-size:30px;letter-spacing:8px;font-weight:700;background:#edf7fa;border-radius:12px;text-align:center;padding:14px;margin:18px 0">${escHtml(code)}</p>`:""}${link?`<p style="text-align:center;margin:22px 0"><a href="${escHtml(link)}" style="background:#087fbd;color:#fff;text-decoration:none;padding:13px 26px;border-radius:12px;font-weight:700;display:inline-block">${escHtml(buttonText||"Open")}</a></p><p style="font-size:12px;color:#60788d;word-break:break-all">If the button does not work, copy this link into your browser:<br>${escHtml(link)}</p>`:""}<p style="font-size:12px;color:#60788d;margin-top:20px">${escHtml(footer||"If you did not request this, you can ignore this email.")}</p></div></div></div>`;
}
const resetLink=raw=>`${config.appPublicUrl.replace(/\/$/,"")}/?reset=${raw}`;
// --- 6-digit email codes (sign-up verification and password reset) ---
const OTP_SEL="+otpHash +otpExpires +otpAttempts +otpSentAt +otpPurpose";
const genCode=()=>String(crypto.randomInt(0,1000000)).padStart(6,"0");
const hashCode=(uid,code)=>crypto.createHash("sha256").update(`${uid}:${code}:${config.jwtSecret}`).digest("hex");
async function issueOtp(user,purpose){
  const code=genCode();
  user.otpHash=hashCode(user.id,code); user.otpExpires=new Date(Date.now()+10*60*1000); user.otpAttempts=0; user.otpSentAt=new Date(); user.otpPurpose=purpose;
  await user.save(); return code;
}
async function verifyOtp(user,purpose,code){
  if(!user.otpHash||user.otpPurpose!==purpose||!user.otpExpires||user.otpExpires<new Date()) return {ok:false,error:"The code is invalid or has expired. Request a new code."};
  if((user.otpAttempts||0)>=5) return {ok:false,error:"Too many wrong attempts. Request a new code."};
  const a=Buffer.from(hashCode(user.id,String(code||"").trim())),b=Buffer.from(user.otpHash);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b)){user.otpAttempts=(user.otpAttempts||0)+1;await user.save();return {ok:false,error:"Incorrect code. Check the email and try again."};}
  return {ok:true};
}
function clearOtp(user){user.otpHash=undefined;user.otpExpires=undefined;user.otpAttempts=undefined;user.otpSentAt=undefined;user.otpPurpose=undefined;}
// Email copy of in-app notifications (to the user's own address).
const EMAIL_TYPES=new Set(["appointment_requested","appointment_status_changed","appointment_cancelled","appointment_time_proposed","appointment_time_declined","appointment_time_accepted","prescription_issued","report_review_requested","report_approved","report_changes_requested","report_rejected","report_assigned"]);
async function emailNotification(userId,title,message){
  if(!mailer()) return;
  const u=await User.findById(userId).select("name email contactEmail status role"); if(!u||u.status!=="active"||u.role==="admin") return;
  const pretty=String(message).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g,iso=>new Date(iso).toLocaleString("en-GB",{timeZone:"Asia/Dhaka",dateStyle:"medium",timeStyle:"short"})+" (Bangladesh time)");
  await sendMailSafe(u.contactEmail||u.email,`MedAI Hospital: ${title}`,`Hello ${u.name},\n\n${pretty}\n\nOpen MedAI Hospital: ${config.appPublicUrl}\n\n- MedAI Hospital`);
}
router.post("/auth/password-reset/request",otpLimiter,wrap(async(req,res)=>{
  const email=String(req.body.email||"").toLowerCase().trim();
  const generic={message:"If the account exists, we emailed a 6-digit code and a reset link."};
  const user=await User.findOne({$or:[{email},{contactEmail:email}]}); if(!user) return res.json(generic);
  if(!mailer()||user.status!=="active") return res.json(generic);
  const raw=crypto.randomBytes(32).toString("hex");
  user.passwordResetHash=crypto.createHash("sha256").update(raw).digest("hex");
  user.passwordResetExpires=new Date(Date.now()+30*60*1000);
  const code=await issueOtp(user,"reset"); // saves the reset hash too
  const link=resetLink(raw);
  await sendMailSafe(user.contactEmail||user.email,"Reset your MedAI Hospital password",`Your password reset code is: ${code}\n\nEnter it on the sign-in page with your new password. It is valid for 10 minutes.\n\nOr open this one-time link within 30 minutes and choose a new password: ${link}\n\nIf you did not request this, ignore this email.`,brandedEmail({title:"Reset your password",intro:`Hello ${escHtml(user.name)}, tap the button below and choose a new password. The link works once and expires in 30 minutes.`,buttonText:"Choose a new password",link,code,footer:"The 6-digit code above can also be entered on the sign-in page (valid 10 minutes). If you did not request this, ignore this email."}));
  await audit(req,"auth.password_reset_requested","User",user.id);
  res.json(generic);
}));
router.post("/auth/password-reset/complete",otpLimiter,wrap(async(req,res)=>{
  const password=String(req.body.newPassword||"");
  if(password.length<14||password.length>128) return res.status(400).json({error:"New password must be 14 to 128 characters"});
  let user=null;
  if(req.body.code){
    const email=String(req.body.email||"").toLowerCase().trim();
    user=await User.findOne({$or:[{email},{contactEmail:email}],status:"active"}).select(OTP_SEL+" +passwordResetHash +passwordResetExpires");
    if(!user) return res.status(400).json({error:"The code is invalid or has expired. Request a new code."});
    const r=await verifyOtp(user,"reset",req.body.code); if(!r.ok) return res.status(400).json({error:r.error});
  } else {
    const token=String(req.body.token||""); if(!token) return res.status(400).json({error:"A valid code or reset link is required"});
    const hash=crypto.createHash("sha256").update(token).digest("hex");
    user=await User.findOne({passwordResetHash:hash,passwordResetExpires:{$gt:new Date()},status:"active"}).select(OTP_SEL+" +passwordResetHash +passwordResetExpires");
    if(!user) return res.status(400).json({error:"Reset link is invalid or expired"});
  }
  user.passwordHash=await hashPassword(password); user.passwordChangedAt=new Date(); user.passwordResetHash=undefined; user.passwordResetExpires=undefined; clearOtp(user); await user.save();
  await ResetRequest.updateMany({userId:user.id,status:"pending"},{$set:{status:"dismissed"}});
  sendMailSafe(user.contactEmail||user.email,"Your MedAI Hospital password was changed",`Hello ${user.name},\n\nYour password was just reset. If this was not you, contact the MedAI admin team immediately.\n\n- MedAI Hospital`).catch(()=>{});
  await audit(req,"auth.password_reset_completed","User",user.id);
  res.json({message:"Password changed. You are now signed in.",token:makeToken(user),user:{id:user.id,name:user.name,email:user.email,role:user.role}});
}));

// --- Appointment availability and double-booking-safe scheduling ---
// ---- Slot helpers: hospital wall-clock (default Asia/Dhaka, UTC+6). Override with HOSPITAL_TZ_OFFSET_MIN.
const TZ_OFF=(process.env.HOSPITAL_TZ_OFFSET_MIN!==undefined&&process.env.HOSPITAL_TZ_OFFSET_MIN!==""&&Number.isFinite(Number(process.env.HOSPITAL_TZ_OFFSET_MIN)))?Number(process.env.HOSPITAL_TZ_OFFSET_MIN):360;
const SLOT_MS=30*60*1000, BOOKED_STATUSES=["confirmed","waiting_room","in_progress"];
function wallClock(d){const x=new Date(d.getTime()+TZ_OFF*60000);return {day:x.getUTCDay(),hm:x.toISOString().slice(11,16)};}
function inAvailability(doctor,when){const w=wallClock(when);return (doctor.doctorProfile?.availabilitySlots||[]).some(x=>x.day===w.day&&x.start<=w.hm&&x.end>w.hm);}
function isBlocked(doctor,when){return (doctor.doctorProfile?.unavailablePeriods||[]).some(x=>when>=x.start&&when<=x.end);}
async function slotIsFree(doctor,when){
  if(Number.isNaN(when.getTime())||when.getTime()<=Date.now()+10*60000)return "That time has already passed or is too soon";
  if(when.getTime()%SLOT_MS!==0)return "Please pick one of the listed time slots";
  if(!inAvailability(doctor,when)||isBlocked(doctor,when))return "That time is outside the doctor's available hours";
  if(await Appointment.exists({doctorId:doctor.id,scheduledAt:when,status:{$in:BOOKED_STATUSES}}))return "That time was just booked. Please pick another slot";
  return "";
}
router.get("/doctors/:id/free-slots",wrap(async(req,res)=>{
  const now=Date.now();const reqFrom=req.query.from?new Date(String(req.query.from)).getTime():now;const from=new Date(Math.max(now+30*60000,reqFrom));const to=req.query.to?new Date(String(req.query.to)):new Date(now+14*86400000);
  if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||to<=from||to-from>31*86400000)return res.status(400).json({error:"Provide a valid date range up to 31 days"});
  if(!mongoose.isValidObjectId(req.params.id))return res.status(404).json({error:"Doctor not found"});
  const doctor=await User.findOne({_id:req.params.id,role:"doctor",status:"active"}).select("name doctorProfile.availabilitySlots doctorProfile.unavailablePeriods");
  if(!doctor)return res.status(404).json({error:"Doctor not found"});
  const booked=await Appointment.find({doctorId:doctor.id,scheduledAt:{$gte:from,$lt:to},status:{$in:BOOKED_STATUSES}}).select("scheduledAt");
  const taken=new Set(booked.map(x=>x.scheduledAt.getTime()));
  const published=(doctor.doctorProfile?.availabilitySlots||[]).length>0;const slots=[];
  if(published){for(let t=Math.ceil(from.getTime()/SLOT_MS)*SLOT_MS;t<to.getTime()&&slots.length<700;t+=SLOT_MS){const d=new Date(t);if(taken.has(t)||!inAvailability(doctor,d)||isBlocked(doctor,d))continue;slots.push(d.toISOString());}}
  res.json({doctor:{_id:doctor.id,name:doctor.name},published,slotMinutes:30,slots});
}));
router.post("/appointments/:id/propose-time",auth,allow("doctor"),wrap(async(req,res)=>{
  const s=z.object({at:z.string().datetime(),note:z.string().max(500).optional().default("")}).safeParse(req.body);
  if(!s.success)return res.status(400).json({error:"Choose a valid time"});
  const appt=await Appointment.findById(req.params.id);if(!appt||String(appt.doctorId)!==String(req.user.id))return res.status(404).json({error:"Appointment not found"});
  if(!["requested","awaiting_records","awaiting_tests","follow_up_required"].includes(appt.status))return res.status(409).json({error:"A time cannot be proposed for this appointment"});
  const doctor=await User.findById(req.user.id);const when=new Date(s.data.at);const why=await slotIsFree(doctor,when);if(why)return res.status(409).json({error:why});
  appt.proposal={at:when,note:s.data.note,proposedAt:new Date(),status:"pending"};await appt.save();
  await notify(appt.patientId,"appointment_time_proposed","New appointment time suggested",`Dr. ${doctor.name} suggested ${when.toISOString()}. Open Appointments to accept or decline.`,"Appointment",appt.id);
  await audit(req,"appointment.time_proposed","Appointment",appt.id);res.json({appointment:appt});
}));
router.post("/appointments/:id/respond-proposal",auth,allow("patient"),wrap(async(req,res)=>{
  const accept=req.body.accept===true;
  const appt=await Appointment.findOne({_id:req.params.id,patientId:req.user.id});if(!appt||appt.proposal?.status!=="pending")return res.status(404).json({error:"No pending time suggestion found"});
  const doctor=await User.findById(appt.doctorId);
  if(!accept){appt.proposal.status="declined";await appt.save();await notify(appt.doctorId,"appointment_time_declined","Suggested time declined","The patient declined the time you suggested. Please suggest another slot.","Appointment",appt.id);return res.json({appointment:appt});}
  const why=await slotIsFree(doctor,new Date(appt.proposal.at));if(why){appt.proposal.status="declined";await appt.save();return res.status(409).json({error:why+". The suggestion was cancelled; the doctor can suggest another time."});}
  appt.scheduledAt=appt.proposal.at;appt.status="confirmed";appt.proposal.status="accepted";
  try{await appt.save();}catch(e){if(e?.code===11000)return res.status(409).json({error:"That time was just booked. Please ask for another slot."});throw e;}
  await notify(appt.doctorId,"appointment_time_accepted","Patient accepted the time","The patient accepted your suggested time. The appointment is confirmed.","Appointment",appt.id);
  await audit(req,"appointment.proposal_accepted","Appointment",appt.id);res.json({appointment:appt});
}));
router.get("/doctors/:id/availability",wrap(async(req,res)=>{
  const from=req.query.from?new Date(String(req.query.from)):new Date(); const to=req.query.to?new Date(String(req.query.to)):new Date(Date.now()+14*86400000);
  if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||to<=from||to-from>31*86400000) return res.status(400).json({error:"Provide a valid date range up to 31 days"});
  const doctor=await User.findOne({_id:req.params.id,role:"doctor",status:"active"}).select("name");
  if(!doctor) return res.status(404).json({error:"Doctor not found"});
  const booked=await Appointment.find({doctorId:doctor.id,scheduledAt:{$gte:from,$lt:to},status:{$in:["confirmed","waiting_room","in_progress"]}}).select("scheduledAt status");
  res.json({doctor,bookedSlots:booked.map(x=>({scheduledAt:x.scheduledAt,status:x.status}))});
}));

// --- Clinician-authored prescriptions and tamper-evident signing ---
router.post("/appointments/:id/prescriptions",auth,allow("doctor"),wrap(async(req,res)=>{
  const appt=await Appointment.findById(req.params.id);
  if(!appt||String(appt.doctorId)!==String(req.user.id)) return res.status(403).json({error:"Only the assigned doctor can create a prescription"});
  if(!PRESCRIBE_STATUSES.includes(appt.status)) return res.status(409).json({error:"Confirm the appointment before prescribing"});
  const c=cleanRxItems(req.body.items); if(c.error) return res.status(400).json({error:c.error});
  const rx=await Prescription.create({appointmentId:appt.id,patientId:appt.patientId,doctorId:req.user.id,items:c.items,notes:String(req.body.notes||"").slice(0,4000)});
  await audit(req,"prescription.draft_created","Prescription",rx.id); res.status(201).json({prescription:rx});
}));
router.patch("/prescriptions/:id",auth,allow("doctor"),wrap(async(req,res)=>{
  const rx=await Prescription.findById(req.params.id);
  if(!rx||String(rx.doctorId)!==String(req.user.id)) return res.status(403).json({error:"Only the prescribing doctor can edit this prescription"});
  if(rx.status!=="draft") return res.status(409).json({error:"Signed prescriptions cannot be edited. Void it and write a new one."});
  const c=cleanRxItems(req.body.items); if(c.error) return res.status(400).json({error:c.error});
  rx.items=c.items; rx.notes=String(req.body.notes||"").slice(0,4000); await rx.save();
  await audit(req,"prescription.draft_updated","Prescription",rx.id); res.json({prescription:rx});
}));
router.delete("/prescriptions/:id",auth,allow("doctor"),wrap(async(req,res)=>{
  const rx=await Prescription.findById(req.params.id);
  if(!rx||String(rx.doctorId)!==String(req.user.id)) return res.status(403).json({error:"Only the prescribing doctor can delete this draft"});
  if(rx.status!=="draft") return res.status(409).json({error:"Only drafts can be deleted"});
  await rx.deleteOne(); await audit(req,"prescription.draft_deleted","Prescription",rx.id); res.json({message:"Draft deleted"});
}));
router.post("/prescriptions/:id/sign",auth,allow("doctor"),wrap(async(req,res)=>{
  const rx=await Prescription.findById(req.params.id).populate("doctorId","name doctorProfile.bmdcNumber doctorProfile.signatureFileId");
  if(!rx||String(rx.doctorId._id)!==String(req.user.id)) return res.status(403).json({error:"Only the prescribing doctor can sign this prescription"});
  if(rx.status!=="draft") return res.status(409).json({error:"Only draft prescriptions can be signed"});
  if(!config.signingPrivateKey||!config.signingPublicKey) return res.status(503).json({error:"Prescription signing keypair is not configured. Generate and set the PRESCRIPTION_SIGNING_PRIVATE_KEY_BASE64 and PRESCRIPTION_SIGNING_PUBLIC_KEY_BASE64 environment variables."});
  const signatureFileId=rx.doctorId.doctorProfile?.signatureFileId;
  const signatureFile=signatureFileId?await PrivateFile.findOne({_id:signatureFileId,ownerId:req.user.id,category:"doctor_signature"}):null;
  if(!signatureFile) return res.status(409).json({error:"Upload your permanent signature in your doctor profile before approving prescriptions"});
  rx.signatureImageFileId=signatureFile._id;
  rx.signatureImageHash=crypto.createHash("sha256").update(await readStoredFileBuffer(uploadDir,signatureFile)).digest("hex");
  rx.signerName=rx.doctorId.name; rx.signerBmdc=rx.doctorId.doctorProfile?.bmdcNumber||""; rx.signedAt=new Date();
  const canonical=prescriptionCanonical(rx);
  const bytes=Buffer.from(canonical,"utf8");
  const signature=crypto.sign(null,bytes,config.signingPrivateKey);
  rx.signatureHash=crypto.createHash("sha256").update(bytes).digest("hex");
  rx.signatureAlgorithm="Ed25519"; rx.signatureValue=signature.toString("base64");
  rx.publicKeyFingerprint=crypto.createHash("sha256").update(config.signingPublicKey).digest("hex");
  rx.status="signed";
  const signatureBytes=await readStoredFileBuffer(uploadDir,signatureFile);
  const patient=await User.findById(rx.patientId).select("name");
  const pdfBuffer=await makePrescriptionPdf({patientName:patient?.name||"Patient",doctorName:rx.signerName,bmdc:rx.signerBmdc,date:rx.signedAt.toLocaleString("en-GB",{timeZone:"Asia/Dhaka"})+" (Bangladesh time)",items:rx.items,notes:rx.notes,signatureBuffer:signatureBytes,signatureHash:rx.signatureHash});
  const pdfFile=await storeBuffer({ownerId:rx.patientId,uploadedBy:req.user.id,category:"report_final_pdf",originalName:"signed-prescription.pdf",mimeType:"application/pdf",buffer:pdfBuffer});rx.pdfFileId=pdfFile._id;
  await rx.save(); await notify(rx.patientId,"prescription_issued","New prescription issued","Your doctor has issued a signed prescription. It is available in your prescription history.","Prescription",rx.id);
  await audit(req,"prescription.signed","Prescription",rx.id,{signatureHash:rx.signatureHash,algorithm:"Ed25519",signatureImageHash:rx.signatureImageHash});
  res.json({prescription:rx,signature:{algorithm:"Ed25519",hash:rx.signatureHash,value:rx.signatureValue,publicKeyFingerprint:rx.publicKeyFingerprint,signedAt:rx.signedAt,signer:rx.signerName,signatureImageFileId:rx.signatureImageFileId,pdfFileId:rx.pdfFileId},notice:"Cryptographic in-app signature and permanent signature-image snapshot. This is not a government-issued qualified digital certificate."});
}));
router.get("/prescriptions/:id/verify",auth,wrap(async(req,res)=>{
  const rx=await Prescription.findById(req.params.id);
  if(!rx) return res.status(404).json({error:"Prescription not found"});
  const allowed=String(rx.patientId)===String(req.user.id)||String(rx.doctorId)===String(req.user.id)||req.user.role==="admin";
  if(!allowed) return res.status(403).json({error:"Access denied"});
  if(rx.status!=="signed"||!rx.signatureValue||!config.signingPublicKey) return res.json({valid:false,reason:"Not signed or verification key unavailable"});
  const canonical=prescriptionCanonical(rx);
  const bytes=Buffer.from(canonical,"utf8");
  const valid=crypto.verify(null,bytes,config.signingPublicKey,Buffer.from(rx.signatureValue,"base64"));
  const hash=crypto.createHash("sha256").update(bytes).digest("hex");
  res.json({valid:valid&&hash===rx.signatureHash,algorithm:rx.signatureAlgorithm,signer:rx.signerName,signedAt:rx.signedAt,hashMatches:hash===rx.signatureHash});
}));
router.get("/prescriptions/mine",auth,wrap(async(req,res)=>{
  // Patients only see signed/voided prescriptions, never drafts.
  const filter=req.user.role==="patient"?{patientId:req.user.id,status:{$in:["signed","voided"]}}:req.user.role==="doctor"?{doctorId:req.user.id}:{};
  const prescriptions=await Prescription.find(filter).populate("doctorId","name doctorProfile.specialty doctorProfile.bmdcNumber").populate("patientId","name").sort({createdAt:-1}).limit(200);
  res.json({prescriptions});
}));
router.post("/prescriptions/:id/void",auth,allow("doctor"),wrap(async(req,res)=>{
  const rx=await Prescription.findById(req.params.id); if(!rx||String(rx.doctorId)!==String(req.user.id)) return res.status(403).json({error:"Only prescribing doctor can void"});
  if(rx.status!=="signed") return res.status(409).json({error:"Only signed prescriptions can be voided"});
  rx.status="voided"; rx.voidReason=String(req.body.reason||"Correction required").slice(0,500); await rx.save();
  await audit(req,"prescription.voided","Prescription",rx.id); res.json({message:"Prescription voided. Create a corrected new prescription."});
}));

// --- Medicine catalogue bulk import (CSV/JSON) ---
const MED_TEXT=["uses","benefits","sideEffects","precautions","interactions","whenToTake"];
function medTextFields(src){const o={};for(const k of MED_TEXT){const v=src[k];if(v!==undefined&&v!==null){o[k]=(Array.isArray(v)?v.join("; "):String(v)).trim().slice(0,1200);}}return o;}
router.post("/admin/medicines/import",auth,allow("admin"),wrap(async(req,res)=>{
  const rows=Array.isArray(req.body.records)?req.body.records:[];
  if(!rows.length||rows.length>5000) return res.status(400).json({error:"Provide 1-5000 medicine records per batch"});
  const sourceName=String(req.body.sourceName||"").slice(0,120), sourceUrl=String(req.body.sourceUrl||"").slice(0,500), sourceLicense=String(req.body.sourceLicense||"").slice(0,200);
  if(!sourceName||!sourceUrl||!sourceLicense) return res.status(400).json({error:"Source name, source URL and data-use/license basis are required"});
  let skipped=0; const ops=[]; const now=new Date();
  for(const r of rows){
    const brand=String(r.brand||r.display||"").trim().slice(0,200), generic=String(r.generic||r.ingredient||"").trim().slice(0,200);
    if(!brand||!generic){skipped++;continue;}
    const reg=String(r.registrationNumber||"").trim();
    const filter=reg?{registrationNumber:reg}:{brand,generic,strength:String(r.strength||""),form:String(r.form||"")};
    // reviewStatus is set only when a record is first inserted, so re-importing never un-verifies reviewed entries.
    ops.push({updateOne:{filter,update:{$set:{brand,generic,strength:String(r.strength||"").slice(0,60),form:String(r.form||"").slice(0,60),manufacturer:String(r.manufacturer||"").slice(0,150),country:"Bangladesh",...medTextFields(r),registrationNumber:reg,sourceName,sourceUrl,sourceLicense,sourceCheckedAt:now,active:true},$setOnInsert:{reviewStatus:"needs_review"}},upsert:true}});
  }
  if(ops.length) await Medicine.bulkWrite(ops,{ordered:false});
  await audit(req,"medicine.catalogue_imported","Medicine","",{imported:ops.length,skipped,sourceName});
  res.json({imported:ops.length,skipped,reviewStatus:"needs_review",message:"New entries are not clinically verified until reviewed by an authorized catalogue reviewer."});
}));

router.get("/admin/medicines/review",auth,allow("admin"),wrap(async(req,res)=>{
  const page=Math.max(1,Number(req.query.page)||1), limit=50;
  const q=String(req.query.q||"").trim().slice(0,60);
  const st=String(req.query.status||"needs_review");const filter=st==="all"?{}:{reviewStatus:["needs_review","verified","rejected"].includes(st)?st:"needs_review"};
  if(q){const rx=new RegExp(escapeRegex(q),"i"); filter.$or=[{brand:rx},{generic:rx}];}
  const [records,total]=await Promise.all([Medicine.find(filter).sort({brand:1}).skip((page-1)*limit).limit(limit),Medicine.countDocuments(filter)]);
  res.json({records,total,page,pages:Math.max(1,Math.ceil(total/limit))});
}));

const medicineInput=z.object({brand:z.string().trim().min(1).max(200),generic:z.string().trim().min(1).max(200),strength:z.string().trim().max(60).optional().default(""),form:z.string().trim().max(60).optional().default(""),manufacturer:z.string().trim().max(150).optional().default(""),
  uses:z.string().max(1200).optional(),benefits:z.string().max(1200).optional(),sideEffects:z.string().max(1200).optional(),precautions:z.string().max(1200).optional(),interactions:z.string().max(1200).optional(),whenToTake:z.string().max(1200).optional()});
router.post("/admin/medicines",auth,allow("admin"),wrap(async(req,res)=>{
  const p=medicineInput.safeParse(req.body);if(!p.success)return res.status(400).json({error:"Brand and generic name are required"});
  const record=await Medicine.create({...p.data,country:"Bangladesh",active:true,reviewStatus:"verified",verifiedAt:new Date(),sourceName:"Added by admin"});
  await audit(req,"medicine.created","Medicine",record.id);res.json({record});
}));
router.patch("/admin/medicines/:id",auth,allow("admin"),wrap(async(req,res)=>{
  const p=medicineInput.partial().safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid medicine details"});
  const record=await Medicine.findByIdAndUpdate(req.params.id,{$set:p.data},{new:true});if(!record)return res.status(404).json({error:"Medicine record not found"});
  await audit(req,"medicine.updated","Medicine",record.id);res.json({record});
}));
router.delete("/admin/medicines/:id",auth,allow("admin"),wrap(async(req,res)=>{
  const record=await Medicine.findByIdAndDelete(req.params.id);if(!record)return res.status(404).json({error:"Medicine record not found"});
  await audit(req,"medicine.deleted","Medicine",req.params.id,{brand:record.brand});res.json({message:"Medicine deleted"});
}));
router.patch("/admin/medicines/:id/review",auth,allow("admin"),wrap(async(req,res)=>{
  const status=String(req.body.status||""); if(!["verified","needs_review","rejected"].includes(status)) return res.status(400).json({error:"Invalid review status"});
  const record=await Medicine.findByIdAndUpdate(req.params.id,{reviewStatus:status,verifiedAt:status==="verified"?new Date():null},{new:true});
  if(!record) return res.status(404).json({error:"Medicine record not found"});
  await audit(req,"medicine.catalogue_reviewed","Medicine",record.id,{status}); res.json({record});
}));
router.post("/admin/medicines/review-bulk",auth,allow("admin"),wrap(async(req,res)=>{
  const status=String(req.body.status||""); const ids=Array.isArray(req.body.ids)?req.body.ids.map(String):[];
  if(!["verified","rejected"].includes(status)) return res.status(400).json({error:"Invalid review status"});
  if(!ids.length||ids.length>200) return res.status(400).json({error:"Select 1-200 records"});
  const result=await Medicine.updateMany({_id:{$in:ids},reviewStatus:"needs_review"},{$set:{reviewStatus:status,verifiedAt:status==="verified"?new Date():null}});
  await audit(req,"medicine.catalogue_bulk_reviewed","Medicine","",{status,count:result.modifiedCount});
  res.json({updated:result.modifiedCount});
}));
router.get("/doctor/unassigned-appointment-requests",auth,allow("doctor"),wrap(async(req,res)=>{
  const requests=await Appointment.find({doctorId:null,status:"requested"}).populate("patientId","name").sort({createdAt:1}); res.json({requests});
}));
router.post("/appointments/:id/claim",auth,allow("doctor"),wrap(async(req,res)=>{
  const doctor=await User.findOne({_id:req.user.id,role:"doctor",status:"active"}); if(!doctor) return res.status(403).json({error:"Verified doctor account required"});
  const appt=await Appointment.findOneAndUpdate({_id:req.params.id,doctorId:null,status:"requested"},{$set:{doctorId:req.user.id}},{new:true});
  if(!appt) return res.status(409).json({error:"This request was already assigned or is no longer available"});
  const unassignedReports=await MedicalReport.find({patientId:appt.patientId,doctorId:null,status:{$in:["pending_doctor_review","under_review","changes_requested"]}}).select("_id");
  if(unassignedReports.length){await MedicalReport.updateMany({_id:{$in:unassignedReports.map(x=>x._id)}},{$set:{doctorId:req.user.id}});for(const report of unassignedReports)await notify(req.user.id,"report_review_requested","Report awaiting review","A patient you have just accepted has a report awaiting review.","MedicalReport",report.id);}
  await audit(req,"appointment.claimed","Appointment",appt.id,{reportsAssigned:unassignedReports.length}); res.json({appointment:appt});
}));

router.get("/admin/users",auth,allow("admin"),wrap(async(req,res)=>{
  const role=["patient","doctor"].includes(String(req.query.role))?String(req.query.role):"doctor";
  const users=await User.find({role,status:{$in:["active","suspended"]}}).select("name email phone status role doctorProfile.specialty doctorProfile.bmdcNumber createdAt").sort({createdAt:-1}).limit(200);
  res.json({users});
}));
router.post("/admin/users/:id/status",auth,allow("admin"),wrap(async(req,res)=>{
  const status=String(req.body.status||""); if(!["active","suspended"].includes(status)) return res.status(400).json({error:"Invalid status"});
  const user=await User.findOne({_id:req.params.id,role:{$in:["patient","doctor"]},status:{$in:["active","suspended"]}});
  if(!user) return res.status(404).json({error:"User not found"});
  user.status=status; await user.save(); await audit(req,`user.${status}`,"User",user.id);
  res.json({user:{_id:user.id,status:user.status}});
}));


// --- Permanent doctor signature management (private image, retained for historical signed records) ---
const signatureUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1},fileFilter:(_req,file,cb)=>{const ok=["image/png","image/jpeg"].includes(file.mimetype);cb(ok?null:new Error("Upload a PNG or JPG signature image"),ok);}});
async function storeBuffer({ownerId,uploadedBy,category,originalName,mimeType,buffer}){
  const actual=detectMimeFromBytes(buffer);
  const compatible=actual===mimeType || (actual==="video/webm"&&mimeType.startsWith("audio/webm")) || (actual==="video/mp4"&&["audio/mp4","video/quicktime"].includes(mimeType));
  if(!compatible) throw Object.assign(new Error("File content does not match its declared type"),{status:400});
  const safeName=String(originalName||"document").replace(/[\\/\x00-\x1f]/g,"_").slice(0,180);
  const gridId=await storeGridFSBuffer({buffer,filename:safeName,mimeType,metadata:{ownerId:String(ownerId),category}});
  try{return await PrivateFile.create({ownerId,uploadedBy,category,originalName:safeName,storedName:String(gridId),storageProvider:"gridfs",mimeType,size:buffer.length});}
  catch(e){await deleteGridFSFile(gridId).catch(()=>{});throw e;}
}
async function notify(userId,type,title,message,resourceType,resourceId){const n=await Notification.create({userId,type,title,message,resourceType,resourceId:String(resourceId||"")});if(EMAIL_TYPES.has(type))emailNotification(userId,title,message).catch(()=>{});return n;}
router.post("/doctor/signature",auth,allow("doctor"),signatureUpload.single("file"),wrap(async(req,res)=>{
  if(!req.file) return res.status(400).json({error:"Choose a signature image"});
  const file=await storeBuffer({ownerId:req.user.id,uploadedBy:req.user.id,category:"doctor_signature",originalName:req.file.originalname,mimeType:req.file.mimetype,buffer:req.file.buffer});
  const doctor=await User.findById(req.user.id); doctor.doctorProfile.signatureFileId=file._id; doctor.doctorProfile.signatureUpdatedAt=new Date(); await doctor.save();
  await audit(req,"doctor.signature_updated","User",doctor.id,{signatureFileId:file.id});
  res.status(201).json({signature:{fileId:file.id,originalName:file.originalName,updatedAt:doctor.doctorProfile.signatureUpdatedAt}});
}));
router.get("/doctor/signature",auth,allow("doctor"),wrap(async(req,res)=>{
  const doctor=await User.findById(req.user.id); const file=doctor.doctorProfile?.signatureFileId?await PrivateFile.findOne({_id:doctor.doctorProfile.signatureFileId,ownerId:req.user.id,category:"doctor_signature"}):null;
  res.json({signature:file?{fileId:file.id,originalName:file.originalName,updatedAt:doctor.doctorProfile.signatureUpdatedAt}:null});
}));
router.get("/prescriptions/:id/signature-image",auth,wrap(async(req,res)=>{
  const rx=await Prescription.findById(req.params.id); if(!rx||rx.status!=="signed"||!rx.signatureImageFileId) return res.status(404).json({error:"Signed signature image not found"});
  if(String(rx.patientId)!==String(req.user.id)&&String(rx.doctorId)!==String(req.user.id)) return res.status(403).json({error:"Access denied"});
  const file=await PrivateFile.findById(rx.signatureImageFileId); if(!file) return res.status(404).json({error:"Signature image unavailable"});
  res.setHeader("Cache-Control","private, no-store"); res.type(file.mimeType); const imagePath=await resolveStoredFilePath(uploadDir,file); res.sendFile(imagePath,()=>{if(file.storageProvider==="gridfs") fs.unlink(imagePath).catch(()=>{});});
}));

// --- ReportSimple-inspired report pipeline: OCR -> deterministic verification -> AI explanation -> doctor review ---
async function extractReportText(file){
  if(file.mimeType==="application/pdf"){
    const pdfModule=await import("pdf-parse"); const parsePdf=pdfModule.default;
    const parsed=await parsePdf(await readStoredFileBuffer(uploadDir,file));
    let text=String(parsed.text||"").trim();
    if(text.length<30){
      // ReportSimple's scanned-PDF path uses Poppler to rasterize each page before Tesseract OCR.
      const tempDir=await fs.mkdtemp(path.join(os.tmpdir(),"medai-pdf-"));
      try{
        const input=await resolveStoredFilePath(uploadDir,file),prefix=path.join(tempDir,"page");
        await execFileAsync("pdftoppm",["-png","-r","180",input,prefix],{timeout:120000,maxBuffer:2*1024*1024});
        const pages=(await fs.readdir(tempDir)).filter(n=>n.endsWith(".png")).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
        if(!pages.length) throw new Error("No PDF pages were rendered");
        const {createWorker}=await import("tesseract.js"); const worker=await createWorker("eng+ben");
        try{for(const page of pages){const out=await worker.recognize(await fs.readFile(path.join(tempDir,page)));text+="\n"+String(out.data?.text||"");}}finally{await worker.terminate();}
      }finally{await fs.rm(tempDir,{recursive:true,force:true});}
    }
    return text;
  }
  const {createWorker}=await import("tesseract.js"); const worker=await createWorker("eng+ben");
  try{const out=await worker.recognize(await readStoredFileBuffer(uploadDir,file));return String(out.data?.text||"").trim();}finally{await worker.terminate();}
}
async function requestReportAI(extracted,verified){
  if(!config.openRouterKey) throw Object.assign(new Error("AI provider is not configured"),{status:503});
  const system="You are a cautious medical report explainer. Never diagnose or prescribe. Treat numeric status supplied in VERIFIED FINDINGS as authoritative and never change it. Explain uncertainty, units, and reference ranges. If data is unclear, explicitly say so. Respond in clear English and do not repeat personal identifiers.";
  const payload={extractedText:extracted.slice(0,12000),verifiedFindings:verified};
  const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${config.openRouterKey}`,"Content-Type":"application/json","HTTP-Referer":config.clientOrigin,"X-Title":"MedAI Hospital"},body:JSON.stringify({model:config.openRouterModel,messages:[{role:"system",content:system},{role:"user",content:JSON.stringify(payload)}],temperature:0.1})});
  if(!response.ok) throw Object.assign(new Error("AI provider request failed"),{status:502}); const data=await response.json(); const answer=data.choices?.[0]?.message?.content;
  if(!answer) throw Object.assign(new Error("AI response was empty"),{status:502}); return String(answer).slice(0,12000);
}
router.post("/reports/:fileId/analyze",auth,allow("patient"),aiLimiter,wrap(async(req,res)=>{
  const file=await PrivateFile.findOne({_id:req.params.fileId,ownerId:req.user.id,category:"patient_report"}); if(!file) return res.status(404).json({error:"Patient report file not found"});
  if(!config.openRouterKey) return res.status(503).json({error:"AI provider is not configured"});
  const appt=await Appointment.findOne({patientId:req.user.id,doctorId:{$ne:null},status:{$in:DOCTOR_ACCESS_STATUSES}}).sort({updatedAt:-1});
  const report=await MedicalReport.create({patientId:req.user.id,doctorId:appt?.doctorId||null,originalFileId:file._id,status:"ai_processing"});
  try{
    let extracted="";
    try { extracted=(await extractReportText(file)).slice(0,12000); }
    catch(e) { if(file.mimeType==="application/pdf") throw e; /* image vision can proceed if OCR fails */ }
    if(extracted.length<20 && file.mimeType==="application/pdf") throw Object.assign(new Error("No readable report text found in PDF. Check Poppler/Tesseract availability or upload a clearer report."),{status:422});
    // Images are sent to a vision-capable model as well as OCR; PDF files use extracted/OCR text.
    const extractionPrompt="Extract medical laboratory findings. Return only JSON {\"findings\":[{\"name\":\"\",\"value\":\"exactly as printed\",\"unit\":\"\",\"normal_range\":\"exactly as printed\"}]}. Never infer or correct numbers. Flag unreadable content. OCR cross-check: "+(extracted||"No usable OCR text was extracted; inspect the attached report image directly.");
    const extractionContent=file.mimeType==="application/pdf"?extractionPrompt:[{type:"text",text:extractionPrompt},{type:"image_url",image_url:{url:`data:${file.mimeType};base64,${(await readStoredFileBuffer(uploadDir,file)).toString("base64")}`}}];
    let candidates=[];
    const extractResponse=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${config.openRouterKey}`,"Content-Type":"application/json","HTTP-Referer":config.clientOrigin,"X-Title":"MedAI Hospital"},body:JSON.stringify({model:config.openRouterModel,messages:[{role:"system",content:"You extract medical laboratory values from supplied text or report images. Copy every numeric value exactly. Do not interpret, diagnose, normalize, or silently fix OCR. Never guess unclear values. Return valid JSON only with findings array containing name, value, unit, normal_range."},{role:"user",content:extractionContent}],temperature:0.0})});
    if(!extractResponse.ok) throw Object.assign(new Error("AI extraction request failed"),{status:502});
    const extractData=await extractResponse.json(); const extraction=String(extractData.choices?.[0]?.message?.content||"");
    try{const match=extraction.match(/\{[\s\S]*\}/); candidates=JSON.parse(match?.[0]||"{}").findings||[];}catch{candidates=[];}
    const profile=await User.findById(req.user.id).select("dateOfBirth gender"); const verified=verifyFindings(candidates,{age:ageFromDob(profile?.dateOfBirth),sex:normSex(profile?.gender)});
    const explanation=await requestReportAI(extracted,verified.findings);
    const urgencyLevel=urgency(verified.findings);
    report.extractedText=extracted;report.analysisMode=file.mimeType==="application/pdf"?"pdf_text_ocr":"image_vision_ocr";report.findings=verified.findings;report.urgencyLevel=urgencyLevel;report.aiExplanation=explanation;report.status="pending_doctor_review";
    const aiPdf=await makeReportPdf({heading:"Lab Report Analysis",subtitle:"AI-assisted report summary",banner:"AI-GENERATED - NOT DOCTOR-APPROVED",
      meta:[["Patient",req.user.name],["Created",new Date().toLocaleString("en-GB",{timeZone:"Asia/Dhaka"})+" (Bangladesh time)"],["Age / sex used",[ageFromDob(profile?.dateOfBirth)??"n/a",normSex(profile?.gender)||"n/a"].join(" / ")]],
      urgency:urgencyLevel,findings:verified.findings,stats:verified.stats,explanation,
      disclaimer:"Educational information only. Not a diagnosis or treatment recommendation. High/low labels come from a rule engine using the printed or table reference range; OCR can misread numbers, so compare with the original report. A doctor must review this."});
    const pdfFile=await storeBuffer({ownerId:req.user.id,uploadedBy:req.user.id,category:"report_ai_pdf",originalName:"AI-report-analysis.pdf",mimeType:"application/pdf",buffer:aiPdf});
    report.aiPdfFileId=pdfFile._id; await report.save();
    if(report.doctorId) await notify(report.doctorId,"report_review_requested","Report awaiting review","A patient report has completed AI analysis and needs your review.","MedicalReport",report.id);
    else {const admins=await User.find({role:"admin",status:"active"}).select("_id");for(const a of admins)await notify(a.id,"report_unassigned","Report needs a doctor",`${req.user.name} uploaded a report that has no doctor yet. Open Reports to assign one.`,"MedicalReport",report.id);}
    await audit(req,"medical_report.ai_completed","MedicalReport",report.id,{findings:verified.stats.total,verified:verified.stats.verified,unchecked:verified.stats.unchecked});
    res.status(201).json({report:{id:report.id,status:report.status,urgencyLevel:report.urgencyLevel,findings:report.findings,aiExplanation:report.aiExplanation,aiPdfFileId:report.aiPdfFileId,doctorAssigned:!!report.doctorId},disclaimer:"AI-generated and not doctor-approved. Numeric labels are rule-engine checks, not a diagnosis. OCR decimal errors and lab-specific reference ranges require verification against the original report."});
  }catch(e){report.status="uploaded";await report.save();throw e;}
}));
router.get("/reports/mine",auth,wrap(async(req,res)=>{
  const filter=req.user.role==="patient"?{patientId:req.user.id}:req.user.role==="doctor"?{doctorId:req.user.id}:{};
  const reports=await MedicalReport.find(filter).populate("patientId","name").populate("doctorId","name doctorProfile.specialty").sort({createdAt:-1}).limit(200);
  res.json({reports});
}));
router.get("/doctor/reports/pending",auth,allow("doctor"),wrap(async(req,res)=>{
  const reports=await MedicalReport.find({doctorId:req.user.id,status:{$in:["pending_doctor_review","under_review","changes_requested"]}}).populate("patientId","name email").populate("originalFileId","originalName mimeType size").sort({createdAt:1});
  res.json({reports});
}));
router.get("/reports/:id",auth,wrap(async(req,res)=>{
  const report=await MedicalReport.findById(req.params.id).populate("patientId","name").populate("doctorId","name doctorProfile.specialty"); if(!report) return res.status(404).json({error:"Report not found"});
  const permitted=String(report.patientId._id)===String(req.user.id)||(req.user.role==="doctor"&&String(report.doctorId?._id)===String(req.user.id))||req.user.role==="admin";
  if(!permitted) return res.status(403).json({error:"Access denied"});
  res.json({report});
}));
router.post("/reports/:id/review",auth,allow("doctor"),wrap(async(req,res)=>{
  const action=String(req.body.action||""); if(!["start","comment","request_changes","reject","approve"].includes(action)) return res.status(400).json({error:"Invalid review action"});
  const report=await MedicalReport.findOne({_id:req.params.id,doctorId:req.user.id}); if(!report) return res.status(404).json({error:"Assigned report not found"});
  if(["approved","signed","delivered","rejected"].includes(report.status)) return res.status(409).json({error:"This report review is already finalized"});
  const comment=String(req.body.comment||"").trim().slice(0,4000);
  if(action==="start") report.status="under_review";
  if(action==="comment"){if(!comment)return res.status(400).json({error:"Add a review comment"});report.status="under_review";report.reviewComment=comment;}
  if(action==="request_changes"){if(!comment)return res.status(400).json({error:"Explain what needs to be corrected"});report.status="changes_requested";report.reviewComment=comment;await notify(report.patientId,"report_changes_requested","Changes requested",comment,"MedicalReport",report.id);}
  if(action==="reject"){if(!comment)return res.status(400).json({error:"A rejection reason is required"});report.status="rejected";report.rejectionReason=comment;report.signatureImageFileId=null;report.signedAt=null;await notify(report.patientId,"report_rejected","Report rejected",comment,"MedicalReport",report.id);}
  if(action==="approve"){
    const doctor=await User.findById(req.user.id); const sigId=doctor.doctorProfile?.signatureFileId;
    const signature= sigId?await PrivateFile.findOne({_id:sigId,ownerId:req.user.id,category:"doctor_signature"}):null;
    if(!signature) return res.status(409).json({error:"Upload your permanent signature in your doctor profile before approving reports"});
    report.status="signed";report.reviewComment=comment||report.reviewComment;report.reviewedAt=new Date();report.signedAt=new Date();report.signatureImageFileId=signature._id;report.signatureImageHash=crypto.createHash("sha256").update(await readStoredFileBuffer(uploadDir,signature)).digest("hex");
    const signatureBytes=await readStoredFileBuffer(uploadDir,signature);
    const patient=await User.findById(report.patientId).select("name");
    const finalPdf=await makeReportPdf({heading:"Doctor-Reviewed Lab Report",subtitle:"Reviewed and approved by a doctor",banner:"DOCTOR-APPROVED",bannerColor:"#17805f",
      meta:[["Patient",patient?.name||"Patient"],["Reviewing doctor",doctor.name],["BMDC",doctor.doctorProfile?.bmdcNumber||"Not provided"],["Approved",report.signedAt.toLocaleString("en-GB",{timeZone:"Asia/Dhaka"})+" (Bangladesh time)"]],
      urgency:report.urgencyLevel,findings:report.findings,
      sections:[{heading:"Doctor review",text:report.reviewComment||"Reviewed and approved."},{heading:"Original AI explanation (not a diagnosis)",text:report.aiExplanation||""}],
      signatureBuffer:signatureBytes,signatureCaption:"Signature is stored as a protected image snapshot on this finalized record.",
      disclaimer:"Educational information. Interpretation of results belongs to your doctor."});
    const finalFile=await storeBuffer({ownerId:report.patientId,uploadedBy:req.user.id,category:"report_final_pdf",originalName:"doctor-approved-report.pdf",mimeType:"application/pdf",buffer:finalPdf});report.finalPdfFileId=finalFile._id;
    await notify(report.patientId,"report_approved","Doctor-approved report available","Your doctor has reviewed and approved a medical report.","MedicalReport",report.id);
  }
  await report.save(); await audit(req,`medical_report.${action}`,"MedicalReport",report.id,{status:report.status});
  res.json({report:{id:report.id,status:report.status,reviewComment:report.reviewComment,rejectionReason:report.rejectionReason,finalPdfFileId:report.finalPdfFileId}});
}));
router.get("/notifications/mine",auth,wrap(async(req,res)=>{const notifications=await Notification.find({userId:req.user.id}).sort({createdAt:-1}).limit(100);res.json({notifications});}));
router.post("/notifications/:id/read",auth,wrap(async(req,res)=>{const n=await Notification.findOneAndUpdate({_id:req.params.id,userId:req.user.id},{$set:{readAt:new Date()}},{new:true});if(!n)return res.status(404).json({error:"Notification not found"});res.json({notification:n});}));

// Doctor availability profile settings; booking still relies on the existing unique appointment-slot index.
router.patch("/doctor/availability",auth,allow("doctor"),wrap(async(req,res)=>{
  const slots=Array.isArray(req.body.slots)?req.body.slots:[]; if(slots.length>21)return res.status(400).json({error:"Maximum 21 availability slots"});
  for(const x of slots){if(!Number.isInteger(x.day)||x.day<0||x.day>6||!/^([01]\d|2[0-3]):[0-5]\d$/.test(x.start||"")||!/^([01]\d|2[0-3]):[0-5]\d$/.test(x.end||"")||x.start>=x.end)return res.status(400).json({error:"Invalid availability slot"});}
  const doctor=await User.findById(req.user.id);doctor.doctorProfile.availabilitySlots=slots;await doctor.save();await audit(req,"doctor.availability_updated","User",doctor.id,{slotCount:slots.length});res.json({slots:doctor.doctorProfile.availabilitySlots});
}));

router.post("/doctor/unavailable-periods",auth,allow("doctor"),wrap(async(req,res)=>{
  const start=new Date(req.body.start),end=new Date(req.body.end),reason=String(req.body.reason||"").slice(0,300);
  if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<=start||end-start>90*86400000)return res.status(400).json({error:"Provide a valid unavailable period up to 90 days"});
  const doctor=await User.findById(req.user.id);doctor.doctorProfile.unavailablePeriods=[...(doctor.doctorProfile.unavailablePeriods||[]),{start,end,reason}].slice(-100);await doctor.save();await audit(req,"doctor.unavailable_period_added","User",doctor.id,{start,end});res.status(201).json({periods:doctor.doctorProfile.unavailablePeriods});
}));

// Admin-initiated password reset: temporary password is returned once, plaintext is never stored.
router.post("/admin/users/:id/reset-password",auth,allow("admin"),sensitiveLimiter,wrap(async(req,res)=>{
  const user=await User.findOne({_id:req.params.id,role:{$in:["patient","doctor"]}});if(!user)return res.status(404).json({error:"User not found"});
  const temporaryPassword=crypto.randomBytes(18).toString("base64url");user.passwordHash=await hashPassword(temporaryPassword);user.passwordChangedAt=new Date();await user.save();
  await audit(req,"admin.password_reset","User",user.id,{targetRole:user.role});
  res.json({message:"Password reset. Share this temporary password securely; it is shown only once.",temporaryPassword});
}));

// ---- Home page banner slideshow (public read, admin edit)
const SLIDE_DEFAULT={eyebrow:"YOUR HEALTH, OUR PRIORITY",title:"Healthcare support, connected around you.",subtitle:"Organize your health journey, request clinician appointments, and understand general health information.",pills:["Patient care","Doctor-led review","Secure access"],linkText:"",linkUrl:"",image:""};
const BANNER_DEFAULT={active:true,intervalSec:5,slides:[SLIDE_DEFAULT]};
const slideSchema=z.object({
  eyebrow:z.string().trim().max(80).optional().default(""),
  title:z.string().trim().min(1).max(140),
  subtitle:z.string().trim().max(400).optional().default(""),
  pills:z.array(z.string().trim().min(1).max(40)).max(5).optional().default([]),
  linkText:z.string().trim().max(40).optional().default(""),
  linkUrl:z.string().trim().max(300).refine(v=>!v||/^https?:\/\//i.test(v),"Link must start with http:// or https://").optional().default(""),
  image:z.string().max(1_000_000).refine(v=>!v||/^data:image\/(png|jpeg|webp);base64,/.test(v),"Image must be PNG, JPG or WEBP").optional().default("")
});
const bannerSchema=z.object({active:z.boolean(),intervalSec:z.number().int().min(3).max(30).default(5),slides:z.array(slideSchema).min(1).max(6)});
async function loadBanner(){
  const s=await Setting.findOne({key:"banner"}).lean();const v=s?.value;
  if(!v)return BANNER_DEFAULT;
  if(Array.isArray(v.slides)&&v.slides.length)return {active:v.active!==false,intervalSec:v.intervalSec||5,slides:v.slides};
  return {active:v.active!==false,intervalSec:5,slides:[{...SLIDE_DEFAULT,...v}]};
}
router.get("/banner",wrap(async(_req,res)=>{res.set("Cache-Control","public, max-age=60");res.json({banner:await loadBanner()});}));
// --- Admin: all patient reports, downloads and doctor assignment ---
const REVIEW_PENDING=["pending_doctor_review","under_review","changes_requested"],REVIEW_APPROVED=["approved","signed","delivered"];
router.get("/admin/reports",auth,allow("admin"),wrap(async(req,res)=>{
  const q=String(req.query.q||"").trim().toLowerCase(); const filter={};
  if(req.query.unassigned==="1") filter.doctorId=null;
  if(req.query.review==="pending") filter.status={$in:REVIEW_PENDING};
  if(req.query.review==="approved") filter.status={$in:REVIEW_APPROVED};
  if(req.query.review==="rejected") filter.status="rejected";
  let reports=await MedicalReport.find(filter).populate("patientId","name email phone").populate("doctorId","name doctorProfile.specialty").populate("originalFileId","originalName mimeType size").select("-extractedText -aiExplanation").sort({createdAt:-1}).limit(300);
  if(q) reports=reports.filter(r=>`${r.patientId?.name||""} ${r.patientId?.email||""}`.toLowerCase().includes(q));
  const rows=reports.map(r=>({_id:r._id,createdAt:r.createdAt,status:r.status,reviewState:REVIEW_APPROVED.includes(r.status)?"approved":r.status==="rejected"?"rejected":REVIEW_PENDING.includes(r.status)?"pending":"not_submitted",analysisState:r.aiPdfFileId?"completed":r.status==="ai_processing"?"processing":"not_analyzed",urgencyLevel:r.urgencyLevel,reviewComment:r.reviewComment,rejectionReason:r.rejectionReason,patient:r.patientId?{_id:r.patientId._id,name:r.patientId.name,email:r.patientId.email,phone:r.patientId.phone}:null,doctor:r.doctorId?{_id:r.doctorId._id,name:r.doctorId.name,specialty:r.doctorId.doctorProfile?.specialty}:null,files:{original:r.originalFileId?{id:r.originalFileId._id,name:r.originalFileId.originalName}:null,aiPdf:r.aiPdfFileId||null,finalPdf:r.finalPdfFileId||null}}));
  const doctors=await User.find({role:"doctor",status:"active"}).select("name doctorProfile.specialty").sort({name:1});
  res.json({reports:rows,doctors:doctors.map(d=>({_id:d._id,name:d.name,specialty:d.doctorProfile?.specialty||""}))});
}));
router.post("/admin/reports/:id/assign",auth,allow("admin"),wrap(async(req,res)=>{
  const s=z.object({doctorId:z.string().min(8)}).safeParse(req.body); if(!s.success) return res.status(400).json({error:"Choose a doctor"});
  const doctor=await User.findOne({_id:s.data.doctorId,role:"doctor",status:"active"}); if(!doctor) return res.status(400).json({error:"Doctor is unavailable"});
  const report=await MedicalReport.findById(req.params.id); if(!report) return res.status(404).json({error:"Report not found"});
  if(REVIEW_APPROVED.includes(report.status)||report.status==="rejected") return res.status(409).json({error:"This report review is already finalized"});
  report.doctorId=doctor._id; await report.save();
  if(report.aiPdfFileId) await notify(doctor.id,"report_review_requested","Report awaiting review","The admin team assigned a patient report to you for review.","MedicalReport",report.id);
  await notify(report.patientId,"report_assigned","Doctor assigned to your report",`Dr. ${doctor.name} was assigned to review your report.`,"MedicalReport",report.id);
  await audit(req,"admin.report_assigned","MedicalReport",report.id,{doctorId:doctor.id});
  res.json({message:`Assigned to Dr. ${doctor.name}`});
}));

router.put("/admin/banner",auth,allow("admin"),wrap(async(req,res)=>{
  const p=bannerSchema.safeParse(req.body);
  if(!p.success)return res.status(400).json({error:p.error.issues[0]?.message||"Invalid banner"});
  await Setting.findOneAndUpdate({key:"banner"},{value:p.data,updatedBy:req.user.id},{upsert:true,new:true});
  await audit(req,"admin.banner_update","Setting","banner",{slides:p.data.slides.length,active:p.data.active});
  res.json({message:"Banner saved",banner:p.data});
}));
router.delete("/admin/banner",auth,allow("admin"),wrap(async(req,res)=>{
  await Setting.deleteOne({key:"banner"});
  await audit(req,"admin.banner_reset","Setting","banner");
  res.json({message:"Banner reset to default",banner:BANNER_DEFAULT});
}));

// ---- Admin: password reset requests and recent sign-ups
router.get("/admin/password-requests",auth,allow("admin"),wrap(async(req,res)=>{
  const status=["pending","sent","dismissed"].includes(String(req.query.status))?String(req.query.status):"pending";
  const requests=await ResetRequest.find({status}).sort({createdAt:-1}).limit(50).populate("userId","name email role status");
  res.json({requests});
}));
router.post("/admin/password-requests/:id/send",auth,allow("admin"),sensitiveLimiter,wrap(async(req,res)=>{
  const rq=await ResetRequest.findOne({_id:req.params.id,status:"pending"});if(!rq)return res.status(404).json({error:"Request not found or already handled"});
  const user=await User.findOne({_id:rq.userId,role:{$in:["patient","doctor"]}}).select("+passwordResetHash +passwordResetExpires");if(!user)return res.status(404).json({error:"User not found"});
  const to=user.contactEmail||user.email;
  if(req.body?.mode==="password"){
    const temporaryPassword=crypto.randomBytes(12).toString("base64url");
    user.passwordHash=await hashPassword(temporaryPassword);user.passwordChangedAt=new Date();user.passwordResetHash=undefined;user.passwordResetExpires=undefined;await user.save();
    const emailed=await sendMailSafe(to,"Your new MedAI Hospital password",`Hello ${user.name},\n\nThe MedAI admin team has set a new temporary password for your account:\n\n${temporaryPassword}\n\nSign in at ${config.appPublicUrl} and change it from your account page right away.`,brandedEmail({title:"Your temporary password",intro:`Hello ${escHtml(user.name)}, the admin team set a temporary password for you. Sign in and change it right away.`,code:temporaryPassword,buttonText:"Go to sign in",link:config.appPublicUrl}));
    rq.status="sent";rq.handledBy=req.user.id;rq.handledAt=new Date();rq.method=emailed?"email":"shown_to_admin";await rq.save();
    await audit(req,"admin.password_reset_sent","User",user.id,{emailed,mode:"password"});
    return res.json(emailed?{emailed:true,message:`Temporary password emailed to ${to}.`}:{emailed:false,temporaryPassword,message:"Email is not configured or failed. Share this temporary password securely; it is shown only once."});
  }
  // Default: one-time link so the person chooses their own password (valid 24 hours).
  const raw=crypto.randomBytes(32).toString("hex");
  user.passwordResetHash=crypto.createHash("sha256").update(raw).digest("hex");user.passwordResetExpires=new Date(Date.now()+24*60*60*1000);await user.save();
  const link=resetLink(raw);
  const emailed=await sendMailSafe(to,"Set a new MedAI Hospital password",`Hello ${user.name},\n\nThe MedAI admin team approved your password reset. Open this one-time link within 24 hours and choose a new password:\n${link}`,brandedEmail({title:"Choose a new password",intro:`Hello ${escHtml(user.name)}, the admin team approved your password reset. Tap the button and choose a new password. The link works once and expires in 24 hours.`,buttonText:"Choose a new password",link}));
  rq.status="sent";rq.handledBy=req.user.id;rq.handledAt=new Date();rq.method=emailed?"email":"shown_to_admin";await rq.save();
  await audit(req,"admin.password_reset_sent","User",user.id,{emailed,mode:"link"});
  res.json(emailed?{emailed:true,message:`Reset link emailed to ${to}.`}:{emailed:false,resetLink:link,message:"Email is not configured or failed. Share this one-time link securely; it is shown only once."});
}));
router.post("/admin/password-requests/:id/dismiss",auth,allow("admin"),wrap(async(req,res)=>{
  const rq=await ResetRequest.findOneAndUpdate({_id:req.params.id,status:"pending"},{$set:{status:"dismissed",handledBy:req.user.id,handledAt:new Date()}},{new:true});
  if(!rq)return res.status(404).json({error:"Request not found or already handled"});res.json({message:"Request dismissed"});
}));

// Admin approves a new account: creates the login ID (email) + password and sends them to the person's contact email.
router.post("/admin/users/:id/issue-credentials",auth,allow("admin"),sensitiveLimiter,wrap(async(req,res)=>{
  const s=z.object({loginEmail:z.string().email().optional(),password:z.string().min(12).max(128).optional(),autoPassword:z.boolean().optional().default(false),sendEmail:z.boolean().optional().default(true)}).safeParse(req.body);
  if(!s.success)return res.status(400).json({error:"Invalid login email, or password shorter than 12 characters"});
  const user=await User.findOne({_id:req.params.id,role:{$in:["patient","doctor"]}}).select("+pendingPassword");
  if(!user)return res.status(404).json({error:"User not found"});
  if(user.status==="pending_verification")return res.status(409).json({error:"Approve this doctor in Doctor verification first"});
  if(!["pending_approval","active"].includes(user.status))return res.status(409).json({error:"This account is rejected or suspended"});
  const loginEmail=(s.data.loginEmail||user.email).toLowerCase().trim();
  if(loginEmail!==user.email&&await User.exists({$or:[{email:loginEmail},{contactEmail:loginEmail}],_id:{$ne:user._id}}))return res.status(409).json({error:"That login email is already used by another account"});
  const password=s.data.password||(s.data.autoPassword?crypto.randomBytes(15).toString("base64url"):"");
  const contact=user.contactEmail||user.email;
  const chosenPw=password?"":openPw(user.pendingPassword);user.pendingPassword=undefined;
  user.contactEmail=contact;user.email=loginEmail;if(password){user.passwordHash=await hashPassword(password);user.passwordChangedAt=new Date();}user.status="active";
  try{await user.save();}catch(e){if(e?.code===11000)return res.status(409).json({error:"That login email is already used by another account"});throw e;}
  let emailed=false;const transport=mailer();
  const pwLine=password?`Password: ${password}\n\nPlease sign in and change your password.`:(chosenPw?`Password: ${chosenPw} (the one you chose when you signed up)`:"Password: the one you chose when you signed up.");
  if(transport&&s.data.sendEmail){try{await transport.sendMail({from:config.smtpFrom,to:contact,subject:"Your MedAI Hospital account is approved",text:`Hello ${user.name},\n\nYour MedAI Hospital account is approved.\nLogin ID (email): ${loginEmail}\n${pwLine}`});emailed=true;}catch{emailed=false;}}
  await audit(req,"admin.account_approved","User",user.id,{emailed,passwordChanged:!!password,loginEmailChanged:loginEmail!==contact});
  const shown=password||chosenPw;
  res.json(emailed?{emailed:true,loginEmail,contactEmail:contact,message:`Account approved. Email sent to ${contact}.`}:{emailed:false,loginEmail,contactEmail:contact,...(shown?{password:shown}:{}),message:"Account approved. Email is not configured or failed, so send these login details to the person yourself."});
}));
router.post("/admin/users/:id/reject-signup",auth,allow("admin"),wrap(async(req,res)=>{
  const user=await User.findOne({_id:req.params.id,role:"patient",status:"pending_approval"});
  if(!user)return res.status(404).json({error:"Request not found or already handled"});
  user.status="rejected";user.pendingPassword=undefined;await user.save();await audit(req,"admin.signup_rejected","User",user.id);res.json({message:"Request rejected"});
}));
router.get("/admin/recent-signups",auth,allow("admin"),wrap(async(_req,res)=>{
  const found=await User.find({role:{$in:["patient","doctor"]}}).sort({createdAt:-1}).limit(30).select("name email contactEmail phone role status createdAt +pendingPassword");
  const users=found.map(u=>{const o=u.toObject();o.requestedPassword=u.status==="pending_approval"?openPw(u.pendingPassword):undefined;delete o.pendingPassword;return o;});res.json({users});
}));

export default router;
