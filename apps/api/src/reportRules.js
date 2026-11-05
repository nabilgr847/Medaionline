// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Report analysis engine, ported from ReportSimple V3 (rules.py).
// The AI model never decides high/low/normal: this deterministic module does.
// Uses 22 reference tests (ranges.json) with age/sex-aware ranges, unit sanity checks,
// printed-range conflicts, OCR-decimal suspicion and plain-language knowledge (knowledge.json).
import fs from "fs";
const load=name=>JSON.parse(fs.readFileSync(new URL(`./data/${name}`,import.meta.url),"utf8"));
const RANGES=load("ranges.json"); const KB=load("knowledge.json").tests;
const TESTS=Object.fromEntries(RANGES.tests.map(t=>[t.key,t]));
export const RANGE_VERSION=RANGES._meta?.version||"";

const EXCLUDE=["vldl","nonhdl","ratio","direct","indirect","mean","volume","distribution","percent","%","crit","index"];
const norm=s=>String(s??"").toLowerCase().replace(/[^a-z0-9]/g,"");
const tokens=s=>new Set(String(s??"").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
const SHORT=[],LONG=[];
for(const t of RANGES.tests) for(const a of t.aliases){const n=norm(a);(n.length<=3?SHORT:LONG).push([n,t.key]);}
SHORT.sort((x,y)=>y[0].length-x[0].length); LONG.sort((x,y)=>y[0].length-x[0].length);

export function canonical(name){
  const n=norm(name),toks=tokens(name),flat=String(name??"").toLowerCase().replace(/\s/g,"");
  if(!n||EXCLUDE.some(x=>flat.includes(x))||(toks.has("non")&&toks.has("hdl"))) return null;
  for(const [a,k] of SHORT) if(toks.has(a)) return k;
  for(const [a,k] of LONG) if(n.includes(a)) return k;
  return null;
}
export function toNumber(value){const m=String(value??"").match(/-?\d[\d,]*\.?\d*/);if(!m)return null;const n=Number(m[0].replace(/,/g,""));return Number.isFinite(n)?n:null;}
export function parseRange(value){
  const s=String(value??"").replace(/,/g,"");
  let m=s.match(/(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*)/);if(m)return [Number(m[1]),Number(m[2])];
  m=s.match(/[<≤]=?\s*(\d+\.?\d*)/);if(m)return [null,Number(m[1])];
  m=s.match(/[>≥]=?\s*(\d+\.?\d*)/);if(m)return [Number(m[1]),null];
  return null;
}
const g=n=>Number(n.toFixed(4)).toString();
export function fmtRange(r){if(!r)return "n/a";const [lo,hi]=r;if(lo!=null&&hi!=null)return `${g(lo)} - ${g(hi)}`;if(hi!=null)return `< ${g(hi)}`;return `> ${g(lo)}`;}
const rangeStatus=(v,lo,hi)=>lo!=null&&v<lo?"low":hi!=null&&v>hi?"high":"normal";
const unitNorm=u=>String(u??"").toLowerCase().replace(/[µμ]/g,"u").replace(/\s+/g,"");
const mid=r=>{const [lo,hi]=r;return lo!=null&&hi!=null?(lo+hi)/2:(hi??lo);};

function tableRange(key,sex,age){
  const t=TESTS[key]; if(!t) return [null,""];
  const r=t.ranges; const adult=age!=null&&age>=18;
  if(r.any) return [r.any,"general adult table"];
  if(adult&&r[sex]) return [r[sex],`adult ${sex} table`];
  return [null,""];
}
function plausible(f,key,tbl,printed){
  const t=TESTS[key],u=unitNorm(f.unit);
  if(u) return t.units.includes(u);
  const ref=printed||tbl;
  if(ref&&tbl&&mid(ref)&&mid(tbl)){const ratio=mid(ref)/mid(tbl);return ratio>=0.33&&ratio<=3;}
  const v=toNumber(f.value);return !!(v&&tbl&&mid(tbl)&&v/mid(tbl)>=0.05&&v/mid(tbl)<=20);
}
export function ageFromDob(dob){
  if(!dob) return null; const d=new Date(dob); if(Number.isNaN(d.getTime())) return null;
  const now=new Date(); let a=now.getFullYear()-d.getFullYear(); const m=now.getMonth()-d.getMonth();
  if(m<0||(m===0&&now.getDate()<d.getDate())) a--; return a>=0&&a<125?a:null;
}
export function normSex(gender){const s=String(gender||"").toLowerCase().trim();return /^(m|male|man|boy|পুরুষ)/.test(s)?"male":/^(f|female|woman|girl|নারী|মহিলা)/.test(s)?"female":null;}

/** input: [{name,value,unit,normal_range}], ctx: {age, sex}. Returns {findings, stats}. */
export function verifyFindings(input=[],ctx={}){
  const sex=normSex(ctx.sex)||null, age=Number.isFinite(ctx.age)?ctx.age:null;
  const stats={total:0,verified:0,corrected:0,unchecked:0,ocrSuspect:0,personalized:0,conflicts:0};
  const findings=(Array.isArray(input)?input:[]).slice(0,100).map(raw=>{
    const f=raw||{};
    const name=String(f.name||"Unknown test").slice(0,120),value=String(f.value??"").slice(0,60),unit=String(f.unit||"").slice(0,40),normalRange=String(f.normal_range??f.normalRange??"").slice(0,80);
    const v=toNumber(value),key=canonical(name),printed=parseRange(normalRange);
    const out={name,value,unit,normalRange,key:key||"",status:"unclear",check:"Not auto-verified: the value or a reference range is unavailable.",rangeUsed:"",rangeSource:"",conflict:"",deviation:0,measures:"",meaning:"",source:"",url:""};
    let tbl=null,tblSrc="";
    if((key&&age!=null&&age>=18)||(key&&!printed)){[tbl,tblSrc]=tableRange(key,sex,age);if(tbl&&!plausible(f,key,tbl,printed)){tbl=null;tblSrc="";}}
    let use=null,src="";
    if(tbl&&age!=null&&age>=18&&sex&&!TESTS[key].ranges.any){use=tbl;src=`${tblSrc} (${sex}, age ${age})`;stats.personalized++;}
    else if(printed){use=printed;src="range printed on the report";}
    else if(tbl){use=tbl;src=tblSrc;}
    if(v!==null&&use){
      const [lo,hi]=use; let st=rangeStatus(v,lo,hi);
      out.rangeUsed=fmtRange(use);out.rangeSource=src;
      out.deviation=st==="high"&&hi?(v-hi)/hi:st==="low"&&lo?(lo-v)/lo:0;
      if(printed&&use!==printed){const ps=rangeStatus(v,printed[0],printed[1]);if(ps!==st){out.conflict=`The report's printed range (${fmtRange(printed)}) would give ${ps.toUpperCase()}, but the ${src} gives ${st.toUpperCase()}. Ask your doctor which range applies.`;stats.conflicts++;}}
      out.check=src==="range printed on the report"?"Verified against the reference range printed on the report.":`Compared with the ${src}; laboratory-specific ranges may differ.`;
      const decimals=[lo,hi].some(b=>b!=null&&!Number.isInteger(b));
      if(st!=="normal"&&decimals&&Number.isInteger(v)&&rangeStatus(v/10,lo,hi)==="normal"){
        st="unclear";out.check+=` Possible OCR decimal loss: value may have been ${v/10}; check the original report.`;stats.ocrSuspect++;stats.unchecked++;
      } else stats.verified++;
      out.status=st; if(f.status&&f.status!==st) stats.corrected++;
    } else stats.unchecked++;
    const kb=key&&KB[key]; if(kb){out.measures=kb.measures||"";out.meaning=(out.status==="high"?kb.high:out.status==="low"?kb.low:"")||"";out.source=kb.source||"";out.url=kb.url||"";}
    return out;
  });
  stats.total=findings.length;
  return {findings,stats};
}
/** Heuristic only (not clinical triage). */
export function urgency(findings){
  let worst="routine";
  for(const f of findings){if(f.status==="high"||f.status==="low"){worst="see_doctor_soon";if((f.deviation||0)>=(f.status==="high"?1.0:0.7))return "urgent";}}
  return worst;
}
export const URGENCY_LABEL={routine:"Routine",see_doctor_soon:"See a doctor soon",urgent:"Urgent: see a doctor promptly"};
