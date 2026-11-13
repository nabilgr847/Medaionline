// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
import test from "node:test";
import assert from "node:assert/strict";
import { fuzzyScore } from "../apps/api/src/util.js";
import { DISEASE_TESTS } from "../apps/api/src/data/diseaseTests.js";
const hit = (q, f) => fuzzyScore(q, f) >= 60;
test("name with spelling mistakes still matches", () => {
  assert.ok(hit("gosur rahmn", ["MD Gausur Rahman"])); assert.ok(hit("nabeel", ["Nabil"])); assert.ok(hit("rahman nabil", ["Gausur Rahman Nabil"]));
});
test("test names and codes", () => {
  assert.ok(hit("hemoglobn", ["Hemoglobin"])); assert.ok(hit("lipid proflie", ["Lipid Profile"])); assert.ok(hit("a1f9c3d2", ["6a1f9c3d2b7e5c44"])); assert.ok(hit("6a1f9c3e", ["6a1f9c3d2b7e5c44"]));
});
test("Bangla text", () => { assert.ok(hit("গউসর", ["গউসুর রহমান"])); });
test("unrelated text does not match", () => { assert.equal(fuzzyScore("xyz", ["Nabil"]), 0); assert.equal(fuzzyScore("rahman ali", ["Gausur Rahman Nabil"]), 0); });
test("disease checklist is spelling tolerant", () => {
  const find = q => DISEASE_TESTS.find(d => fuzzyScore(q, d.names) >= 60)?.names[0];
  assert.equal(find("denge"), "dengue"); assert.equal(find("diabetis"), "diabetes"); assert.equal(find("high bp"), "hypertension"); assert.equal(find("jondis"), "jaundice");
});
