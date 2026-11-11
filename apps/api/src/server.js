// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import express from "express";
import crypto from "crypto";
import corsMiddleware from "./cors.js";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import {config, configProblems} from "./config.js";
import routes from "./routes.js";
import commercialRoutes from "./commercial.js";
import {User, Appointment, SystemError, CallSession} from "./models.js";
import {hashPassword} from "./security.js";

function sanitizeErrorMessage(value){
  return String(value||"Unknown error").slice(0,1000)
    .replace(/(password|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,"$1=[REDACTED]")
    .replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi,"mongodb://[REDACTED]");
}
const app=express();
app.disable("x-powered-by");
app.set("trust proxy",1); // Render/other reverse proxies: use the real client IP for rate limits and audit logs
app.use(helmet());
app.use(corsMiddleware);
app.use(express.json({limit:"10mb"}));
// Global limiter. Must answer in JSON (the web app parses it), and must not count the guest-room / heartbeat
// polling requests: those fire every 1-3 seconds and would otherwise exhaust the IP's budget within minutes,
// making every other page (dashboard, AI chat, report upload) fail with "Request failed".
const POLLING_PATH=/^\/api\/(temporary-consults\/[^/]+\/room\/|presence\/heartbeat|appointments\/[^/]+\/call-heartbeat)/;
app.use(rateLimit({windowMs:15*60*1000,limit:600,standardHeaders:true,legacyHeaders:false,skip:req=>POLLING_PATH.test(req.originalUrl.split("?")[0]),message:{error:"Too many requests. Please wait a minute and try again."}}));
// Health always answers, even when the deployment is misconfigured, so the web app and the
// APK can show the real reason instead of a bare "Failed to fetch".
let runtimeProblem = configProblems.length ? "Server configuration incomplete — " + configProblems.join("; ") : null;
app.get("/api/health",(_req,res)=>res.json({status:runtimeProblem?"misconfigured":"ok",service:"MedAI Hospital API",version:process.env.APP_VERSION||"3.9",problem:runtimeProblem}));
app.use("/api",(req,res,next)=>{
  if(!runtimeProblem) return next();
  res.status(503).json({error:runtimeProblem});
});
app.use("/api",routes);
app.use("/api/commercial",commercialRoutes);
app.use((err,req,res,_next)=>{
  const requestId=crypto.randomUUID();
  console.error("API error:",{requestId,name:err.name,message:err.message,method:req.method,path:req.path});
  SystemError.create({requestId,severity:(err.status>=500||!err.status)?"error":"warning",errorName:String(err.name||"Error").slice(0,120),message:sanitizeErrorMessage(err.message),statusCode:Number.isInteger(err.status)?err.status:500,method:req.method,route:req.route?.path||req.path,actorId:req.user?.id||null}).catch(logErr=>console.error("Could not persist system error:",logErr.message));
  if(err.name==="MulterError" || String(err.message||"").startsWith("Supported files:") || String(err.message||"").startsWith("Upload a PDF,")) return res.status(400).json({error:err.message});
  if(err.expose) return res.status(Number.isInteger(err.status)?err.status:502).json({error:err.message});
  if(err.name==="CastError") return res.status(400).json({error:"Invalid identifier"});
  if(err.code==="STORED_FILE_MISSING" || err.status===410) return res.status(410).json({error:err.message});
  if(Number.isInteger(err.status)&&err.status>=400&&err.status<500) return res.status(err.status).json({error:err.message||"Request failed"});
  res.status(500).json({error:err.message==="Only PDF, JPG, PNG, and WEBP files are accepted"?err.message:"Internal server error",requestId});
});
async function start(){
  if(!runtimeProblem){
    try{
      await mongoose.connect(config.mongoUri,{serverSelectionTimeoutMS:15000});
      await Appointment.createIndexes();
      await CallSession.createIndexes();
    }catch(e){
      runtimeProblem="The API is running but cannot reach the database — check MONGODB_URI (Atlas IP whitelist must allow 0.0.0.0/0)";
      console.error("Database connection failed:",e.message);
    }
  }
  if(!runtimeProblem){
    if(config.adminEmail && config.adminPassword){
      if(config.adminPassword.length<14) throw new Error("ADMIN_PASSWORD must be at least 14 characters");
      const existing=await User.findOne({email:config.adminEmail});
      if(!existing){
        await User.create({name:"MedAI Super Admin",email:config.adminEmail,passwordHash:await hashPassword(config.adminPassword),role:"admin",status:"active"});
        console.log("Initial Super Admin account provisioned from environment.");
      } else if(existing.role!=="admin") {
        throw new Error("ADMIN_EMAIL already belongs to a non-admin account. Use a dedicated admin email.");
      }
    } else console.warn("ADMIN_EMAIL/ADMIN_PASSWORD not set; no admin account was provisioned.");
  } else console.error("RUNNING IN DEGRADED MODE:",runtimeProblem);
  if(process.env.NODE_ENV==="production" && (config.uploadDir==="/tmp" || config.uploadDir.startsWith("/tmp/"))) console.warn("WARNING: UPLOAD_DIR points to temporary storage. Uploaded files may disappear after restart/deploy. Configure a persistent disk or object storage.");
  console.log(`Private upload storage configured at ${config.uploadDir}`);
  app.listen(config.port,()=>console.log(`MedAI Hospital API listening on ${config.port}`));
}
process.on("unhandledRejection",r=>console.error("Unhandled rejection:",r instanceof Error?r.message:r));
process.on("SIGTERM",()=>{console.log("SIGTERM received, shutting down");mongoose.connection.close().finally(()=>process.exit(0));});
// Last-resort safety net: never die silently during startup.
start().catch(e=>{
  console.error("Startup failed:",e);
  runtimeProblem="Startup failed: "+e.message;
  try{ app.listen(config.port,()=>console.log(`MedAI Hospital API listening on ${config.port} (degraded: ${e.message})`)); }
  catch{ process.exit(1); }
});
