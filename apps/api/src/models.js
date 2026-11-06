// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import mongoose from "mongoose";
const { Schema, model } = mongoose;
const userSchema = new Schema({
  name: {type:String, required:true, trim:true, maxlength:120},
  email: {type:String, required:true, unique:true, lowercase:true, trim:true},
  phone: {type:String, default:"", maxlength:30},
  contactEmail: {type:String, lowercase:true, trim:true},
  passwordHash: {type:String, required:true, select:false},
  role: {type:String, enum:["patient","doctor","admin"], required:true},
  status: {type:String, enum:["active","pending_email","pending_verification","pending_approval","rejected","suspended"], default:"active"},
  dateOfBirth: Date, address: String, gender: String, bloodGroup: String,
  allergies: [String], currentMedicines: [String], medicalHistory: String,
  emergencyContact: {name:String, phone:String, relationship:String},
  passwordChangedAt: Date, lastLoginAt:Date, lastSeenAt:Date,
  notifyEmailOnMessage: {type:Boolean, default:true},
  passwordResetHash: {type:String, select:false},
  passwordResetExpires: {type:Date, select:false},
  pendingPassword: {type:String, select:false},
  otpHash: {type:String, select:false}, otpExpires: {type:Date, select:false}, otpAttempts: {type:Number, select:false}, otpSentAt: {type:Date, select:false}, otpPurpose: {type:String, select:false},
  doctorProfile: {
    bmdcNumber:String, bio:{type:String,default:"",maxlength:1000}, specialty:String, qualifications:[String], experienceYears:Number,
    clinicName:String, verificationNote:String, verifiedAt:Date, signatureFileId:{type:Schema.Types.ObjectId,ref:"PrivateFile",default:null}, signatureUpdatedAt:Date, availabilitySlots:[{day:Number,start:String,end:String}], unavailablePeriods:[{start:Date,end:Date,reason:String}]
  }
}, {timestamps:true});
userSchema.index({role:1,status:1,createdAt:-1});
userSchema.index({name:1});
userSchema.index({email:1});
userSchema.index({phone:1});

const fileSchema = new Schema({
  ownerId:{type:Schema.Types.ObjectId, ref:"User", required:true},
  category:{type:String, enum:["doctor_photo","bmdc_certificate","degree_certificate","identity_document","other_qualification","patient_report","consultation_recording","doctor_signature","report_ai_pdf","report_final_pdf","chat_attachment","other"], required:true},
  originalName:{type:String, required:true}, storedName:{type:String, required:true}, storageProvider:{type:String,enum:["local","gridfs"],default:"local"},
  mimeType:{type:String, required:true}, size:Number, uploadedBy:{type:Schema.Types.ObjectId, ref:"User"}
}, {timestamps:true});

const appointmentSchema = new Schema({
  patientId:{type:Schema.Types.ObjectId, ref:"User", required:true},
  doctorId:{type:Schema.Types.ObjectId, ref:"User"},
  problem:{type:String, required:true, maxlength:4000},
  requestedAt:{type:Date, default:Date.now},
  scheduledAt:Date, consultationType:{type:String, enum:["online","in_person"], default:"online"},
  status:{type:String, enum:["requested","awaiting_records","awaiting_tests","confirmed","waiting_room","in_progress","completed","cancelled","rejected","follow_up_required"], default:"requested"},
  clinicianNote:String,
  preferredAt:Date,
  proposal:{at:Date,note:{type:String,maxlength:500},proposedAt:Date,status:{type:String,enum:["pending","accepted","declined"]}},
  pastDiseases:{type:String,default:"",maxlength:2000}, pastInfo:{type:String,default:"",maxlength:4000},
  recordingConsent:{patientAt:{type:Date,default:null},doctorAt:{type:Date,default:null}}
}, {timestamps:true});

// Database-enforced slot uniqueness prevents concurrent double booking.
appointmentSchema.index({doctorId:1, scheduledAt:1},{unique:true,partialFilterExpression:{doctorId:{$type:"objectId"},scheduledAt:{$type:"date"},status:{$in:["confirmed","waiting_room","in_progress"]}}});

const messageSchema = new Schema({
  appointmentId:{type:Schema.Types.ObjectId, ref:"Appointment", default:null},
  senderId:{type:Schema.Types.ObjectId, ref:"User", required:true},
  body:{type:String, default:"", maxlength:5000},
  attachments:[{fileId:{type:Schema.Types.ObjectId,ref:"PrivateFile"}, originalName:String, mimeType:String, kind:{type:String,enum:["image","audio","video","file"],default:"file"}, size:Number}]
}, {timestamps:true});

const auditSchema = new Schema({
  actorId:{type:Schema.Types.ObjectId, ref:"User"},
  action:String, targetType:String, targetId:String, metadata:Schema.Types.Mixed,
  ip:String
}, {timestamps:true});

const medicineSchema = new Schema({
  brand:{type:String, required:true}, generic:{type:String, required:true},
  strength:String, form:String, manufacturer:String, country:{type:String, default:"Bangladesh"},
  verifiedAt:Date, active:{type:Boolean, default:true},
  uses:String, benefits:String, sideEffects:String, precautions:String, interactions:String, whenToTake:String,
  registrationNumber:String, sourceName:String, sourceUrl:String, sourceCheckedAt:Date, sourceLicense:String, reviewStatus:{type:String,enum:["unreviewed","verified","needs_review","rejected"],default:"unreviewed"}
}, {timestamps:true});

medicineSchema.index({brand:1});
medicineSchema.index({generic:1});
medicineSchema.index({registrationNumber:1});
medicineSchema.index({reviewStatus:1, brand:1});

export const User = model("User", userSchema);
export const PrivateFile = model("PrivateFile", fileSchema);
export const Appointment = model("Appointment", appointmentSchema);
export const Message = model("Message", messageSchema);
const directConversationSchema = new Schema({
  participants:[{type:Schema.Types.ObjectId,ref:"User",required:true}],
  participantKey:{type:String,required:true,unique:true,index:true},
  lastMessageAt:{type:Date,default:Date.now}
},{timestamps:true});
directConversationSchema.index({participants:1,lastMessageAt:-1});
export const DirectConversation = model("DirectConversation",directConversationSchema);
const directMessageSchema = new Schema({
  conversationId:{type:Schema.Types.ObjectId,ref:"DirectConversation",required:true,index:true},
  senderId:{type:Schema.Types.ObjectId,ref:"User",required:true},
  body:{type:String,default:"",maxlength:5000},
  attachments:[{fileId:{type:Schema.Types.ObjectId,ref:"PrivateFile"},originalName:String,mimeType:String,kind:{type:String,enum:["image","audio","video","file"],default:"file"},size:Number}]
},{timestamps:true});
directMessageSchema.index({conversationId:1,createdAt:1});
export const DirectMessage = model("DirectMessage",directMessageSchema);
const temporaryConsultSchema = new Schema({
  tokenHash:{type:String,required:true,unique:true}, createdBy:{type:Schema.Types.ObjectId,ref:"User",required:true},
  doctorId:{type:Schema.Types.ObjectId,ref:"User",default:null}, patientName:{type:String,default:"Guest patient",maxlength:120},
  patientPhone:{type:String,default:"",maxlength:30}, expiresAt:{type:Date,required:true},
  messages:[{senderRole:{type:String,enum:["guest","doctor","admin"]},senderName:{type:String,maxlength:120},body:{type:String,maxlength:3000},createdAt:{type:Date,default:Date.now}}],
  status:{type:String,enum:["active","closed","expired"],default:"active",index:true}, closedAt:Date
},{timestamps:true});
temporaryConsultSchema.index({expiresAt:1},{expireAfterSeconds:0});
export const TemporaryConsult = model("TemporaryConsult",temporaryConsultSchema);
const temporaryCallSignalSchema = new Schema({
  consultId:{type:Schema.Types.ObjectId,ref:"TemporaryConsult",required:true,index:true},
  senderRole:{type:String,enum:["guest","doctor","admin"],required:true},
  senderName:{type:String,default:"Guest"}, type:{type:String,enum:["offer","answer","ice","hangup","admin_end"],required:true},
  payload:{type:Schema.Types.Mixed}
},{timestamps:true});
temporaryCallSignalSchema.index({createdAt:1},{expireAfterSeconds:14400});
temporaryCallSignalSchema.index({consultId:1,createdAt:1});
export const TemporaryCallSignal = model("TemporaryCallSignal",temporaryCallSignalSchema);

export const AuditEvent = model("AuditEvent", auditSchema);
export const Medicine = model("Medicine", medicineSchema);
const prescriptionSchema = new Schema({
  appointmentId:{type:Schema.Types.ObjectId,ref:"Appointment",default:null},
  reportId:{type:Schema.Types.ObjectId,ref:"MedicalReport",default:null,index:true},
  patientId:{type:Schema.Types.ObjectId,ref:"User",required:true},
  doctorId:{type:Schema.Types.ObjectId,ref:"User",required:true},
  status:{type:String,enum:["draft","signed","voided"],default:"draft"},
  signatureImageFileId:{type:Schema.Types.ObjectId,ref:"PrivateFile",default:null}, signatureImageHash:String, pdfFileId:{type:Schema.Types.ObjectId,ref:"PrivateFile",default:null},
  items:[{brand:String,generic:{type:String,required:true},strength:String,form:String,dose:{type:String,required:true},frequency:{type:String,required:true},duration:{type:String,required:true},instructions:String,medicineId:{type:Schema.Types.ObjectId,ref:"Medicine"}}],
  notes:String, advisedTests:String, clinical:{complaints:String,history:String,examination:String,vitals:String,diagnosis:String,pastTests:String,advice:String,followUp:String}, signedAt:Date, signatureHash:String, signatureAlgorithm:String, signatureValue:String, publicKeyFingerprint:String, signerName:String, signerBmdc:String, voidReason:String,
  // V3.8.3: secret access code — only admin/doctor can see
  secretAccessCode:{type:String,index:true,sparse:true}
},{timestamps:true});
prescriptionSchema.index({appointmentId:1,createdAt:-1});
prescriptionSchema.index({secretAccessCode:1},{unique:true,sparse:true});
export const Prescription = model("Prescription",prescriptionSchema);
// V3.8: combined analysis of several reports (trend + possible conditions), reviewed by a doctor.
const multiAnalysisSchema = new Schema({
  patientId:{type:Schema.Types.ObjectId,ref:"User",required:true,index:true},
  doctorId:{type:Schema.Types.ObjectId,ref:"User",default:null,index:true},
  requestedBy:{type:Schema.Types.ObjectId,ref:"User",required:true}, requestedByRole:{type:String,enum:["patient","doctor"],required:true},
  reportIds:[{type:Schema.Types.ObjectId,ref:"MedicalReport"}],
  status:{type:String,enum:["pending_doctor_review","approved","rejected"],default:"pending_doctor_review",index:true},
  trends:Schema.Types.Mixed, ai:Schema.Types.Mixed,
  doctorFinal:{summary:String,conditions:[{name:String,likelihood:String,note:String}],tests:[String],specialty:String,advice:String,urgency:String},
  doctorNote:String, reviewedAt:Date, aiPdfFileId:{type:Schema.Types.ObjectId,ref:"PrivateFile",default:null}
},{timestamps:true});
export const MultiAnalysis = model("MultiAnalysis",multiAnalysisSchema);
const callSignalSchema = new Schema({
  appointmentId:{type:Schema.Types.ObjectId,ref:"Appointment",required:true,index:true},
  senderId:{type:Schema.Types.ObjectId,ref:"User",required:true},
  senderRole:{type:String,default:""}, to:{type:Schema.Types.ObjectId,ref:"User",default:null},
  type:{type:String,enum:["offer","answer","ice","hangup"],required:true},
  payload:{type:Schema.Types.Mixed}
},{timestamps:true});
callSignalSchema.index({createdAt:1},{expireAfterSeconds:86400});
export const CallSignal = model("CallSignal",callSignalSchema);


const medicalReportSchema = new Schema({
  patientId:{type:Schema.Types.ObjectId,ref:"User",required:true,index:true}, doctorId:{type:Schema.Types.ObjectId,ref:"User",default:null,index:true}, originalFileId:{type:Schema.Types.ObjectId,ref:"PrivateFile",required:true},
  status:{type:String,enum:["uploaded","ai_processing","ai_analysis_completed","pending_doctor_review","under_review","changes_requested","rejected","approved","signed","delivered"],default:"uploaded",index:true},
  docType:{type:String,enum:["lab","imaging","prescription"],default:"lab"}, aiStructured:Schema.Types.Mixed,
  extractedText:String, analysisMode:{type:String,enum:["pdf_text_ocr","image_vision_ocr"]}, findings:[{name:String,value:String,unit:String,normalRange:String,status:String,check:String,key:String,rangeUsed:String,rangeSource:String,conflict:String,deviation:Number,measures:String,meaning:String,source:String,url:String}], urgencyLevel:String, aiExplanation:String, aiPdfFileId:{type:Schema.Types.ObjectId,ref:"PrivateFile"}, finalPdfFileId:{type:Schema.Types.ObjectId,ref:"PrivateFile"},
  reviewComment:String, doctorExplanation:String, advisedTests:String, rejectionReason:String, reviewedAt:Date, signedAt:Date, signatureImageFileId:{type:Schema.Types.ObjectId,ref:"PrivateFile"}, signatureImageHash:String, deliveredAt:Date,
  // V3.8.3: secret access code — only admin/doctor can see & use; patient never receives it
  secretAccessCode:{type:String,index:true,sparse:true},
  simpleSummary:{type:String,default:""} // patient-friendly short summary (Bangla/English)
},{timestamps:true});
medicalReportSchema.index({doctorId:1,status:1,createdAt:-1});
medicalReportSchema.index({secretAccessCode:1},{unique:true,sparse:true});
const notificationSchema = new Schema({userId:{type:Schema.Types.ObjectId,ref:"User",required:true,index:true},type:{type:String,required:true},title:{type:String,required:true},message:{type:String,required:true},resourceType:String,resourceId:String,count:{type:Number,default:1},readAt:Date},{timestamps:true});
notificationSchema.index({userId:1,createdAt:-1});
export const MedicalReport = model("MedicalReport", medicalReportSchema);
export const Notification = model("Notification", notificationSchema);
const chatSessionSchema = new Schema({userId:{type:Schema.Types.ObjectId,ref:"User",required:true,index:true},title:{type:String,default:"New chat",maxlength:120},messages:{type:Schema.Types.Mixed,default:[]}},{timestamps:true});
chatSessionSchema.index({userId:1,updatedAt:-1});
export const ChatSession = model("ChatSession", chatSessionSchema);

const systemErrorSchema = new Schema({
  requestId:{type:String,index:true}, severity:{type:String,enum:["warning","error","critical"],default:"error"},
  errorName:String, message:{type:String,required:true}, statusCode:Number, method:String, route:String,
  actorId:{type:Schema.Types.ObjectId,ref:"User",default:null}, resolvedAt:Date, resolvedBy:{type:Schema.Types.ObjectId,ref:"User",default:null}
},{timestamps:true});
systemErrorSchema.index({resolvedAt:1,createdAt:-1});
export const SystemError = model("SystemError",systemErrorSchema);


// Operational call metadata only. This stores no audio, video, transcript, or SDP payload.
const callSessionSchema = new Schema({
  appointmentId:{type:Schema.Types.ObjectId,ref:"Appointment",required:true,index:true},
  patientId:{type:Schema.Types.ObjectId,ref:"User",required:true,index:true},
  doctorId:{type:Schema.Types.ObjectId,ref:"User",required:true,index:true},
  status:{type:String,enum:["active","ended","stale"],default:"active",index:true},
  startedAt:{type:Date,default:Date.now}, lastHeartbeatAt:{type:Date,default:Date.now}, endedAt:Date,
  lastConnectionState:{type:String,enum:["starting","connected","disconnected","failed","ended"],default:"starting"}
},{timestamps:true});
callSessionSchema.index({appointmentId:1,status:1});
callSessionSchema.index({lastHeartbeatAt:1});
export const CallSession = model("CallSession",callSessionSchema);

const settingSchema = new Schema({
  key:{type:String, required:true, unique:true},
  value:{type:Schema.Types.Mixed, default:{}},
  updatedBy:{type:Schema.Types.ObjectId, ref:"User"}
},{timestamps:true});
export const Setting = model("Setting",settingSchema);

const resetRequestSchema = new Schema({
  userId:{type:Schema.Types.ObjectId, ref:"User", required:true},
  email:{type:String, required:true},
  status:{type:String, enum:["pending","sent","dismissed"], default:"pending"},
  handledBy:{type:Schema.Types.ObjectId, ref:"User"}, handledAt:Date, method:String
},{timestamps:true});
resetRequestSchema.index({status:1,createdAt:-1});
export const ResetRequest = model("ResetRequest",resetRequestSchema);

// V3.8.3: Admin-editable disease / condition knowledge base (replaces hard-coded diseaseTests.js as source of truth)
const diseaseSchema = new Schema({
  names:[{type:String,required:true,trim:true}], // primary + aliases + Bangla
  tests:[{
    name:{type:String,required:true},
    reason:{type:String,default:""},
    priority:{type:String,enum:["routine","soon","urgent"],default:"routine"}
  }],
  notes:{type:String,default:"",maxlength:2000},
  active:{type:Boolean,default:true},
  source:{type:String,enum:["seed","admin","json_import","ai_prompt"],default:"admin"},
  updatedBy:{type:Schema.Types.ObjectId,ref:"User"}
},{timestamps:true});
diseaseSchema.index({names:1});
diseaseSchema.index({active:1,"names":1});
export const Disease = model("Disease",diseaseSchema);

// Access audit for secret codes
const accessAuditSchema = new Schema({
  actorId:{type:Schema.Types.ObjectId,ref:"User",required:true},
  actorRole:{type:String,required:true},
  resourceType:{type:String,enum:["report","prescription","file"],required:true},
  resourceId:{type:Schema.Types.ObjectId,required:true},
  codeUsed:{type:String,default:""},
  action:{type:String,default:"open"},
  ip:String
},{timestamps:true});
accessAuditSchema.index({resourceId:1,createdAt:-1});
export const AccessAudit = model("AccessAudit",accessAuditSchema);
