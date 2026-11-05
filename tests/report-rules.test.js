import test from "node:test";
import assert from "node:assert/strict";
import {parseRange,toNumber,verifyFindings} from "../apps/api/src/reportRules.js";

test("parses numeric reference ranges and comparator ranges",()=>{
  assert.deepEqual(parseRange("13.0 - 17.0"),[13,17]);
  assert.deepEqual(parseRange("< 200"),[null,200]);
  assert.deepEqual(parseRange(">= 40"),[40,null]);
  assert.equal(toNumber("1,250.5 mg/dL"),1250.5);
});
test("rule engine classifies only against explicit or fallback ranges",()=>{
  const r=verifyFindings([
    {name:"Hemoglobin",value:"10.2",unit:"g/dL",normal_range:"12.0 - 17.0"},
    {name:"HbA1c",value:"6.2",unit:"%",normal_range:"4.0 - 5.6"},
    {name:"Unknown marker",value:"3.1",unit:"x",normal_range:""}
  ]);
  assert.deepEqual(r.findings.map(x=>x.status),["low","high","unclear"]);
  assert.equal(r.stats.verified,2);assert.equal(r.stats.unchecked,1);
});
test("possible OCR decimal errors are not silently classified",()=>{
  const r=verifyFindings([{name:"HbA1c",value:"41",unit:"%",normal_range:"4.0-5.6"}]);
  assert.equal(r.findings[0].status,"unclear");
  assert.match(r.findings[0].check,/OCR decimal loss/);
});

import {canonical,ageFromDob,normSex,urgency} from "../apps/api/src/reportRules.js";
test("ReportSimple engine: aliases, sex/age ranges, conflicts and knowledge",()=>{
  assert.equal(canonical("Hb"),"hemoglobin");assert.equal(canonical("LDL Cholesterol"),"ldl");assert.equal(canonical("VLDL"),null);
  const r=verifyFindings([{name:"Hemoglobin",value:"12.5",unit:"g/dL",normal_range:"12.0 - 17.0"}],{age:30,sex:"male"});
  assert.equal(r.findings[0].status,"low");assert.match(r.findings[0].rangeSource,/male/);assert.match(r.findings[0].conflict,/printed range/);
  assert.ok(r.findings[0].meaning.length>10);assert.equal(r.stats.personalized,1);
  const noPrinted=verifyFindings([{name:"Creatinine",value:"3.2",unit:"mg/dL",normal_range:""}],{age:40,sex:"female"});
  assert.equal(noPrinted.findings[0].status,"high");
  assert.equal(urgency(verifyFindings([{name:"Hemoglobin",value:"3",unit:"g/dL",normal_range:"12-17"}]).findings),"urgent");
  assert.equal(normSex("Female"),"female");assert.ok(ageFromDob("2000-01-01")>=25);
});
test("unit mismatch is never compared",()=>{
  const r=verifyFindings([{name:"Glucose fasting",value:"5.4",unit:"mmol/L",normal_range:""}],{age:30,sex:"male"});
  assert.equal(r.findings[0].status,"unclear");
});

import {checkRedFlags} from "../apps/api/src/safety.js";
test("red flags run before AI",()=>{
  assert.equal(checkRedFlags("I can't breathe").level,"emergency");
  assert.equal(checkRedFlags("আমার বুকে ব্যথা, ঘাম হচ্ছে").level,"emergency");
  assert.equal(checkRedFlags("chest pain since morning").level,"urgent");
  assert.equal(checkRedFlags("what is paracetamol used for").level,"routine");
});
