// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import PDFDocument from "pdfkit";
import fs from "fs";
import QRCode from "qrcode";
import { URGENCY_LABEL } from "./reportRules.js";

const BLUE="#087fbd",TEAL="#20a58a",NAVY="#102e49",MUTED="#60788d";
const FONT_DIR=new URL("../assets/fonts/",import.meta.url);
const bnRegular=new URL("NotoSansBengali-Regular.ttf",FONT_DIR),bnBold=new URL("NotoSansBengali-Bold.ttf",FONT_DIR);
const HAS_BN=fs.existsSync(bnRegular);
export const PDF_HAS_BANGLA=HAS_BN;
const BN_RE=/[\u0980-\u09FF]/;

// ---- text helpers: Latin text uses Helvetica, Bangla runs use Noto Sans Bengali when installed ----
function segs(t){
  const out=[];let cur="",bn=null;
  for(const ch of t){
    const isB=/[\u0980-\u09FF\u200c\u200d]/.test(ch),neutral=/[\s\d.,;:!?()\-–\/%|]/.test(ch);
    const c=neutral&&bn!==null?bn:isB; if(bn===null)bn=c;
    if(c!==bn){out.push([cur,bn]);cur="";bn=c;} cur+=ch;
  } if(cur)out.push([cur,bn]); return out;
}
const latin=s=>String(s??"").replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2013\u2014]/g,"-").replace(/[^\x09\x0A\x20-\x7E\u00A0-\u00FF\u2022]/g,"?");
// Writes text (optionally at x,y). base: "Helvetica" | "Helvetica-Bold".
function put(doc,text,x,y,opts={},base="Helvetica"){
  const t=String(text??"");
  if(!HAS_BN||!BN_RE.test(t)){doc.font(base);return x==null?doc.text(latin(t),opts):doc.text(latin(t),x,y,opts);}
  const parts=segs(t),bold=/Bold/.test(base);
  parts.forEach(([s,isBn],i)=>{
    doc.font(isBn?(bold?"BnBold":"Bn"):base);
    const o=i===0?{...opts,continued:i<parts.length-1}:{continued:i<parts.length-1};
    if(i===0&&x!=null) doc.text(s,x,y,o); else doc.text(s,o);
  });
}
const height=(doc,text,width,size,base="Helvetica")=>{doc.font(HAS_BN&&BN_RE.test(String(text))?"Bn":base).fontSize(size);return doc.heightOfString(HAS_BN&&BN_RE.test(String(text))?String(text):latin(text),{width});};

// ---- brand ----
export function drawLogo(doc,x,y,s=0.3){
  doc.save();doc.translate(x,y);doc.scale(s);doc.translate(18,20);
  doc.roundedRect(42,0,42,110,12).fill(BLUE);doc.roundedRect(8,34,110,42,12).fill(BLUE);
  doc.path("M63 42 C36 15 10 54 63 96 C116 54 90 15 63 42 Z").lineWidth(4).fillAndStroke(TEAL,"#ffffff");
  doc.path("M27 58 h22 l8 -12 l12 25 l9 -13 h20").lineWidth(4).lineCap("round").stroke("#ffffff");
  doc.restore();
}
function pageHeader(doc,subtitle){
  doc.save();
  doc.rect(0,0,297.5,5).fill(BLUE);doc.rect(297.5,0,297.5,5).fill(TEAL);
  drawLogo(doc,40,16,0.3);
  doc.font("Helvetica-Bold").fontSize(17).fillColor(NAVY).text("MedAI",84,26,{lineBreak:false});
  doc.font("Helvetica").fontSize(10).fillColor(BLUE).text("Hospital",84,45,{lineBreak:false});
  if(subtitle) doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(latin(subtitle),300,30,{width:255,align:"right",lineBreak:false});
  doc.moveTo(48,68).lineTo(547,68).lineWidth(0.8).strokeColor("#dce8ef").stroke();
  doc.restore();
}
function pageFooters(doc,note){
  const r=doc.bufferedPageRange();
  for(let i=0;i<r.count;i++){
    doc.switchToPage(r.start+i);doc.page.margins.bottom=0;
    doc.moveTo(48,800).lineTo(547,800).lineWidth(0.6).strokeColor("#dce8ef").stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(latin(note||"MedAI Hospital - Your Health, Our Priority. Informational document; not a substitute for a doctor."),48,806,{width:400,lineBreak:false});
    doc.text(`Page ${i+1} of ${r.count}`,447,806,{width:100,align:"right",lineBreak:false});
  }
}
function newDoc(title,subtitle){
  const doc=new PDFDocument({size:"A4",margins:{top:84,bottom:56,left:48,right:48},bufferPages:true,info:{Title:latin(title),Author:"MedAI Hospital"}});
  if(HAS_BN){doc.registerFont("Bn",bnRegular.pathname);doc.registerFont("BnBold",fs.existsSync(bnBold)?bnBold.pathname:bnRegular.pathname);}
  pageHeader(doc,subtitle);doc.on("pageAdded",()=>pageHeader(doc,subtitle));
  doc.x=48;doc.y=84;return doc;
}
const finish=(doc,note)=>new Promise((resolve,reject)=>{const chunks=[];doc.on("data",c=>chunks.push(c));doc.on("error",reject);doc.on("end",()=>resolve(Buffer.concat(chunks)));pageFooters(doc,note);doc.end();});
const ensure=(doc,h)=>{if(doc.y+h>780)doc.addPage();doc.x=48;};
function title(doc,text,color=NAVY){ensure(doc,40);put(doc,text,48,doc.y,{width:499},"Helvetica-Bold");}
function h2(doc,text){ensure(doc,40);doc.moveDown(0.6);doc.fillColor(BLUE).fontSize(12.5);put(doc,text,48,doc.y,{width:499},"Helvetica-Bold");doc.moveDown(0.25);doc.fillColor(NAVY);}
function para(doc,text,size=9.5,color=NAVY){
  for(const p of String(text??"").split(/\n+/)){ if(!p.trim())continue; ensure(doc,height(doc,p,499,size)+6);doc.fontSize(size).fillColor(color);put(doc,p,48,doc.y,{width:499,lineGap:2.5});doc.moveDown(0.35);}
}
function badge(doc,text,fill){
  ensure(doc,28);const y=doc.y;doc.font("Helvetica-Bold").fontSize(9);const w=doc.widthOfString(latin(text))+22;
  doc.roundedRect(48,y,w,20,10).fill(fill);doc.fillColor("#ffffff").text(latin(text),48,y+5.5,{width:w,align:"center",lineBreak:false});doc.y=y+28;doc.x=48;doc.fillColor(NAVY);
}
function metaGrid(doc,pairs){
  const rows=pairs.filter(p=>p&&p[1]);if(!rows.length)return;ensure(doc,rows.length*15+16);
  const y0=doc.y;doc.roundedRect(48,y0,499,rows.length*15+12,10).fill("#f4f8fb");
  rows.forEach(([k,v],i)=>{doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(latin(k),60,y0+8+i*15,{width:110,lineBreak:false});doc.fillColor(NAVY);put(doc,v,175,y0+8+i*15,{width:360,lineBreak:false,height:12,ellipsis:true},"Helvetica-Bold");});
  doc.y=y0+rows.length*15+22;doc.x=48;
}
const STATUS={high:["#fdecea","#b3261e","HIGH"],low:["#fff4e0","#a35a00","LOW"],normal:["#eaf7f1","#17805f","NORMAL"],unclear:["#eef1f4","#55677a","CHECK"]};
function summaryStrip(doc,findings){
  const counts={high:0,low:0,normal:0,unclear:0};findings.forEach(f=>counts[STATUS[f.status]?f.status:"unclear"]++);
  ensure(doc,56);const y=doc.y,w=118;
  ["high","low","normal","unclear"].forEach((k,i)=>{const x=48+i*(w+9);doc.roundedRect(x,y,w,44,10).fill(STATUS[k][0]);doc.fillColor(STATUS[k][1]).font("Helvetica-Bold").fontSize(18).text(String(counts[k]),x+12,y+6,{lineBreak:false});doc.font("Helvetica").fontSize(8.5).text(STATUS[k][2]==="CHECK"?"NEEDS CHECK":STATUS[k][2],x+12,y+28,{lineBreak:false});});
  doc.y=y+56;doc.x=48;doc.fillColor(NAVY);
}
const COLS=[[48,128,"Test"],[176,62,"Value"],[238,90,"Range used"],[328,52,"Status"],[380,167,"Notes"]];
function tableHeader(doc){const y=doc.y;doc.rect(48,y,499,20).fill(BLUE);doc.fillColor("#fff").font("Helvetica-Bold").fontSize(8.5);COLS.forEach(([x,w,t])=>doc.text(t,x+6,y+6,{width:w-8,lineBreak:false}));doc.y=y+20;doc.x=48;}
function resultsTable(doc,findings){
  ensure(doc,60);tableHeader(doc);
  for(const f of findings){
    const [bg,fg,lab]=STATUS[f.status]||STATUS.unclear;
    const val=`${f.value||""} ${f.unit||""}`.trim(),rng=f.rangeUsed||f.normalRange||"n/a";
    const note=[f.conflict,f.check&&f.status==="unclear"?f.check:"",f.status!=="normal"&&f.meaning?f.meaning:""].filter(Boolean).join(" ");
    const h=Math.max(height(doc,f.name,120,8.8,"Helvetica-Bold"),height(doc,val,54,8.8),height(doc,rng,82,8.5),height(doc,note,159,7.8))+10;
    if(doc.y+h>775){doc.addPage();tableHeader(doc);}
    const y=doc.y;doc.rect(48,y,499,h).fill(bg==="#eaf7f1"?"#ffffff":bg);doc.moveTo(48,y+h).lineTo(547,y+h).lineWidth(0.4).strokeColor("#dce8ef").stroke();
    doc.fillColor(NAVY).fontSize(8.8);put(doc,f.name,54,y+5,{width:120,lineBreak:true},"Helvetica-Bold");
    doc.fillColor(NAVY).fontSize(8.8);put(doc,val,182,y+5,{width:54});
    doc.fillColor(MUTED).fontSize(8.5);put(doc,rng,244,y+5,{width:82});
    doc.roundedRect(332,y+4,44,14,7).fill(fg);doc.fillColor("#fff").font("Helvetica-Bold").fontSize(7.5).text(lab,332,y+8,{width:44,align:"center",lineBreak:false});
    doc.fillColor(MUTED).fontSize(7.8);put(doc,note,386,y+5,{width:159});
    doc.y=y+h;doc.x=48;
  }
  doc.moveDown(0.8);doc.fillColor(NAVY);
}
function signature(doc,buf,label,caption){
  ensure(doc,140);doc.moveDown(0.6);const y=doc.y;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text(label||"Doctor signature",48,y,{lineBreak:false});
  const y0=y+16;
  try{doc.save();doc.image(buf,48,y0,{fit:[180,70]});doc.restore();}catch{throw new Error("Signature image could not be embedded. Upload a PNG or JPG signature.");}
  doc.moveTo(48,y0+74).lineTo(240,y0+74).lineWidth(0.6).strokeColor("#9fb3c4").stroke();
  doc.y=y0+80;doc.x=48;
  if(caption){doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);put(doc,caption,48,doc.y,{width:499});}
  doc.fillColor(NAVY);
}

function qrBlock(doc,buf){
  if(!buf)return; ensure(doc,100);doc.moveDown(0.6);const y=doc.y;
  try{doc.image(buf,48,y,{fit:[78,78]});}catch{return;}
  doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY).text("Secure record QR",136,y+16,{width:400,lineBreak:false});
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("Scan to open this record. Works only for a signed-in MedAI doctor or admin.",136,y+31,{width:400});
  doc.y=y+86;doc.x=48;doc.fillColor(NAVY);
}
const qrPng=t=>t?QRCode.toBuffer(String(t),{width:240,margin:1,errorCorrectionLevel:"M"}).catch(()=>null):Promise.resolve(null);

/** Structured lab-report PDF (AI analysis and doctor-approved versions). */
const ACCENT={"Summary":BLUE,"What stands out":TEAL,"What to do next":"#b26a00","Doctor review":"#17805f","Bangla summary":"#6b5bd6","Tests to do":"#6b5bd6","When to see a doctor":"#c0392b"};
const FILL={"What to do next":"#fff6e0","Doctor review":"#eaf7f1","When to see a doctor":"#fdf0ee"};
/** Section card: soft background, coloured accent bar, heading, bullet lines. */
function card(doc,heading,text){
  const accent=ACCENT[heading]||BLUE,fill=FILL[heading]||"#f6f9fc",W=455;
  const paras=String(text||"").split(/\n+/).map(p=>p.trim()).filter(Boolean).map(p=>p.replace(/^-\s+/,"\u2022 "));
  if(!paras.length)return;
  let h=38;for(const p of paras)h+=height(doc,p,W,9.5)+5;
  ensure(doc,h+6);const y=doc.y;
  doc.roundedRect(48,y,499,h,9).fill(fill);doc.roundedRect(48,y,5,h,2.5).fill(accent);
  doc.fillColor(accent).fontSize(11);put(doc,heading,66,y+11,{width:W,lineBreak:false},"Helvetica-Bold");
  let cy=y+31;doc.fillColor(NAVY).fontSize(9.5);
  for(const p of paras){put(doc,p,66,cy,{width:W,lineGap:2},"Helvetica");cy+=height(doc,p,W,9.5)+5;}
  doc.y=y+h+9;doc.x=48;doc.fillColor(NAVY);
}
/** Three-step approval tracker: AI analysis -> sent to doctor -> doctor approval. */
function timelineBlock(doc,steps){
  if(!steps||!steps.length)return;ensure(doc,76);const y=doc.y,n=steps.length,colW=499/n;
  doc.roundedRect(48,y,499,64,10).fill("#f6f9fc");
  const col={done:TEAL,current:"#d98a00",todo:"#b8c4cf",bad:"#c0392b"};
  steps.forEach((s,i)=>{const cx=48+colW*i+colW/2;
    if(i<n-1)doc.moveTo(cx+11,y+17).lineTo(cx+colW-11,y+17).lineWidth(2).strokeColor(s.state==="done"?TEAL:"#d5dee6").stroke();
    doc.circle(cx,y+17,9).fill(col[s.state]||col.todo);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8).text(s.state==="done"?"OK":s.state==="bad"?"X":String(i+1),cx-9,y+13.5,{width:18,align:"center",lineBreak:false});
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text(latin(s.label),cx-colW/2+4,y+33,{width:colW-8,align:"center",lineBreak:false});
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(latin(s.sub||""),cx-colW/2+4,y+46,{width:colW-8,align:"center",lineBreak:false,ellipsis:true});
  });
  doc.y=y+76;doc.x=48;doc.fillColor(NAVY);
}
/** Original file thumbnail on the left, report details on the right. */
function topCard(doc,img,pairs){
  const rows=pairs.filter(p=>p&&p[1]);if(!rows.length&&!img)return;
  const mh=rows.length*17+18;ensure(doc,Math.max(mh,img?172:0)+8);const y=doc.y;let x=48,w=499,shown=false;
  if(img){try{doc.roundedRect(48,y,150,150,10).lineWidth(1).strokeColor("#d5dee6").stroke();doc.image(img,53,y+5,{fit:[140,140],align:"center",valign:"center"});shown=true;}catch{shown=false;}
    if(shown){doc.fillColor(MUTED).font("Helvetica").fontSize(8).text("Your original file",48,y+155,{width:150,align:"center",lineBreak:false});x=212;w=335;}}
  const ch=Math.max(mh,shown?150:0);
  doc.roundedRect(x,y,w,ch,10).fill("#f4f8fb");
  rows.forEach(([k,v],i)=>{doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(latin(k),x+12,y+10+i*17,{width:92,lineBreak:false});doc.fillColor(NAVY);put(doc,v,x+106,y+10+i*17,{width:w-118,lineBreak:false,height:13,ellipsis:true},"Helvetica-Bold");});
  doc.y=y+Math.max(ch,shown?170:0)+10;doc.x=48;doc.fillColor(NAVY);
}
export async function makeReportPdf({qrText,heading,subtitle,banner,bannerColor="#b26a00",meta=[],urgency,findings=[],stats,explanation,sections=[],leadSections=[],originalImage,showCounts=true,timeline=[],signatureBuffer,signatureCaption,disclaimer,footerNote}){
  const qrBuf=await qrPng(qrText);
  const doc=newDoc(heading,subtitle);
  doc.font("Helvetica-Bold").fontSize(21).fillColor(NAVY);put(doc,heading,48,doc.y,{width:499},"Helvetica-Bold");doc.moveDown(0.4);
  if(banner)badge(doc,banner,bannerColor);
  topCard(doc,originalImage,[...meta,urgency?["Review priority",URGENCY_LABEL[urgency]||urgency]:null]);
  timelineBlock(doc,timeline);
  if(findings.length&&showCounts)summaryStrip(doc,findings);
  for(const s of leadSections)card(doc,s.heading,s.text);
  if(explanation&&!leadSections.length)card(doc,"Plain-language explanation",explanation);
  for(const s of sections)card(doc,s.heading,s.text);
  if(findings.length){h2(doc,"All results and ranges");resultsTable(doc,findings);
    if(stats&&(stats.unchecked||stats.ocrSuspect||stats.conflicts))para(doc,`${stats.unchecked} value(s) could not be auto-verified${stats.ocrSuspect?`, ${stats.ocrSuspect} possible OCR misread`:""}${stats.conflicts?`, ${stats.conflicts} range conflict(s)`:""}. Please compare these with the original report.`,8.5,MUTED);}
  else if(showCounts)para(doc,"No laboratory values could be read from this report.",9.5,MUTED);
  if(signatureBuffer)signature(doc,signatureBuffer,"Doctor signature",signatureCaption);
  qrBlock(doc,qrBuf);
  if(disclaimer){doc.moveDown(0.4);ensure(doc,50);const y=doc.y,h=height(doc,disclaimer,475,8)+14;doc.roundedRect(48,y,499,h,8).fill("#fff6e0");doc.fillColor("#7a4b00").fontSize(8);put(doc,disclaimer,60,y+7,{width:475});}
  return finish(doc,footerNote);
}

/** Generic branded text PDF (prescriptions and any other plain document). Lines ending with ":" become headings. */
export function makeTextPdf(heading,lines,signatureBuffer=null,signatureMime="image/png"){
  const doc=newDoc(heading,"");
  doc.fillColor(NAVY);put(doc,String(heading).slice(0,160),48,doc.y,{width:499},"Helvetica-Bold");doc.fontSize(18);doc.moveDown(0.8);
  for(const raw of lines||[]){
    const line=String(raw??"").slice(0,1500);
    if(!line.trim()){doc.moveDown(0.4);continue;}
    if(/^[A-Z0-9 \/\-]{8,}$/.test(line)&&line===line.toUpperCase()){badge(doc,line,line.includes("VOID")?"#b3261e":BLUE);continue;}
    if(/^[A-Za-z ]{3,40}:$/.test(line)){h2(doc,line.slice(0,-1));continue;}
    para(doc,line,9.5);
  }
  if(signatureBuffer)signature(doc,signatureBuffer,"Doctor signature","");
  return finish(doc);
}

/** Signed prescription PDF with a medicine table. */
export async function makePrescriptionPdf({qrText,patientName,patientAge,patientSex,clinical,doctorName,bmdc,date,items=[],notes,advisedTests,signatureBuffer,signatureHash,voided=false}){
  const qrBuf=await qrPng(qrText);
  const doc=newDoc("Prescription","Signed prescription");
  doc.font("Helvetica-Bold").fontSize(20).fillColor(NAVY);put(doc,"Prescription",48,doc.y,{width:499},"Helvetica-Bold");doc.moveDown(0.5);
  badge(doc,voided?"VOIDED - DO NOT USE":"FINALIZED / DOCTOR-SIGNED",voided?"#b3261e":BLUE);
  metaGrid(doc,[["Patient",patientName],["Age / Sex",[patientAge!=null&&patientAge!==""?patientAge+" y":"",patientSex||""].filter(Boolean).join(" / ")||"-"],["Doctor",doctorName],["BMDC",bmdc||"Not provided"],["Signed on (date & time)",date]]);
  const cl=clinical||{};
  [["Chief complaints","complaints"],["Past history","history"],["Past tests / reports","pastTests"],["Examination","examination"],["Vitals","vitals"],["Diagnosis","diagnosis"]].forEach(([t,k])=>{if(cl[k]){h2(doc,t);para(doc,cl[k]);}});
  ensure(doc,60);doc.moveDown(0.4);doc.font("Helvetica-BoldOblique").fontSize(26).fillColor(BLUE).text("Rx",48,doc.y);doc.x=48;doc.moveDown(0.2);
  h2(doc,"Medicines");
  const cols=[[48,22,"#"],[70,150,"Medicine"],[220,70,"Dose"],[290,80,"Frequency"],[370,65,"Duration"],[435,112,"Instructions"]];
  const head=()=>{const y=doc.y;doc.rect(48,y,499,20).fill(BLUE);doc.fillColor("#fff").font("Helvetica-Bold").fontSize(8.5);cols.forEach(([x,w,t])=>doc.text(t,x+5,y+6,{width:w-6,lineBreak:false}));doc.y=y+20;doc.x=48;};
  ensure(doc,60);head();
  items.forEach((x,i)=>{
    const med=`${x.brand?x.brand+" ("+x.generic+")":x.generic||""} ${x.strength||""} ${x.form||""}`.trim();
    const cells=[String(i+1),med,x.dose||"",x.frequency||"",x.duration||"",x.instructions||""];
    const h=Math.max(...cells.map((c,k)=>height(doc,c,cols[k][1]-8,8.6)))+10;
    if(doc.y+h>775){doc.addPage();head();}
    const y=doc.y;if(i%2)doc.rect(48,y,499,h).fill("#f4f8fb");doc.fillColor(NAVY).fontSize(8.6);
    cells.forEach((c,k)=>put(doc,c,cols[k][0]+5,y+5,{width:cols[k][1]-8},k===1?"Helvetica-Bold":"Helvetica"));
    doc.moveTo(48,y+h).lineTo(547,y+h).lineWidth(0.4).strokeColor("#dce8ef").stroke();doc.y=y+h;doc.x=48;
  });
  if(advisedTests){h2(doc,"Advised tests");para(doc,advisedTests);}
  if(cl.advice){h2(doc,"Advice");para(doc,cl.advice);}
  if(cl.followUp){h2(doc,"Follow-up");para(doc,cl.followUp);}
  if(notes){h2(doc,"Doctor's notes");para(doc,notes);}
  if(signatureBuffer)signature(doc,signatureBuffer,"Doctor signature",`Signed by ${doctorName||""}${date?" - "+date:""}`);
  qrBlock(doc,qrBuf);
  if(signatureHash){doc.moveDown(0.8);ensure(doc,40);doc.fontSize(7.5).fillColor(MUTED);put(doc,`In-app digital signature (Ed25519). Content hash: ${signatureHash}. This is not a government-issued qualified digital certificate.`,48,doc.y,{width:499});}
  return finish(doc,"MedAI Hospital - Prescription. Take medicines only as directed by your doctor.");
}
