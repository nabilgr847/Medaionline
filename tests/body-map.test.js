// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Guards for the full-body 3D pain map: the shipped model, its licence trail, the
// patient → chosen doctor route, the appointment pain site, and the safety rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const ANATOMY = join(root, "apps/web/public/anatomy");
const MODEL = join(ANATOMY, "body.glb");

const routes = read("apps/api/src/routes.js");
const models = read("apps/api/src/models.js");
const viewer = read("apps/web/src/body3d.tsx");
const builder = read("scripts/anatomy/build-anatomy-model.mjs");
const attribution = read("apps/web/public/anatomy/ATTRIBUTION.md");
const manifest = JSON.parse(read("apps/web/public/anatomy/body.parts.json"));
const parts = manifest.parts;
assert.ok(Array.isArray(parts) && parts.length > 100, "body.parts.json must list the anatomy parts");

function readGlb(file = MODEL) {
  const buffer = readFileSync(file);
  assert.equal(buffer.readUInt32LE(0), 0x46546c67, "not a GLB file");
  assert.equal(buffer.readUInt32LE(4), 2, "GLB version must be 2");
  assert.equal(buffer.readUInt32LE(8), buffer.length, "GLB length header is wrong");
  const jsonLength = buffer.readUInt32LE(12);
  assert.equal(buffer.readUInt32LE(16), 0x4e4f534a, "first chunk must be JSON");
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8"));
  const binaryStart = 20 + jsonLength;
  const binLength = buffer.readUInt32LE(binaryStart);
  assert.equal(buffer.readUInt32LE(binaryStart + 4), 0x004e4942, "second chunk must be BIN");
  return { json, bin: buffer.subarray(binaryStart + 8, binaryStart + 8 + binLength), bytes: buffer.length };
}

const { json: glb, bin, bytes } = readGlb();

test("one complete body ships in one file, small enough for a phone", () => {
  // V3.13 was 13 MB, V3.14 split it into layers the patient had to hunt for. One body, one file.
  assert.ok(bytes <= 8 * 1024 * 1024, `body.glb is ${(bytes / 1048576).toFixed(1)} MB — trim it again`);
  assert.ok(statSync(join(ANATOMY, "body.parts.json")).size < 400 * 1024);
  assert.deepEqual(manifest.files.map((f) => f.file), ["body.glb"]);
  assert.ok(manifest.files[0].triangles > 250000, "the full body needs its triangles");
});

test("the body has bones, organs, muscles and vessels together", () => {
  const systems = new Set(parts.map((p) => p.system));
  for (const keep of ["skeletal", "cardiac", "respiratory", "digestive", "urinary", "nervous", "muscular", "arterial", "venous"]) {
    assert.ok(systems.has(keep), `missing system: ${keep}`);
  }
  for (const drop of ["lymphatic", "integumentary", "connective"]) {
    assert.ok(!systems.has(drop), `${drop} was meant to stay out`);
  }
  const brain = parts.filter((p) => /brain|spinal cord/i.test(p.name));
  assert.ok(brain.length > 0, "the nervous system must be reduced to brain / spinal cord");
  for (const part of parts) {
    assert.ok(typeof part.name === "string" && part.name.trim().length >= 2, "every part needs a readable name");
    assert.ok(typeof part.system === "string" && part.system.length > 0, "every part belongs to a system");
  }
});

test("the file is safe for uint16 indices and every id has a name", () => {
  assert.equal(glb.materials.length >= 9, true, "one material per system");
  for (const mesh of glb.meshes) {
    const primitive = mesh.primitives[0];
    const position = glb.accessors[primitive.attributes.POSITION];
    const ids = glb.accessors[primitive.attributes._PARTID];
    const indices = glb.accessors[primitive.indices];
    assert.equal(ids.componentType, 5123, "_PARTID must be uint16");
    assert.equal(indices.componentType, 5123, "indices must stay uint16 (meshes are chunked for this)");
    assert.equal(ids.count, position.count, "every vertex needs exactly one part id");
  }
  const mesh = glb.meshes.reduce((a, b) => (a.primitives[0].attributes._PARTID > b.primitives[0].attributes._PARTID ? a : b));
  const accessor = glb.accessors[mesh.primitives[0].attributes._PARTID];
  const view = glb.bufferViews[accessor.bufferView];
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const ids = new Uint16Array(bin.buffer, bin.byteOffset + start, Math.min(accessor.count, 4096));
  for (const id of ids) assert.ok(id < parts.length, `part id ${id} has no name`);
});

test("the model is in metres with the feet near zero", () => {
  for (const mesh of glb.meshes) {
    const accessor = glb.accessors[mesh.primitives[0].attributes.POSITION];
    assert.equal(accessor.type, "VEC3");
    assert.equal(accessor.componentType, 5126, "positions must be float32");
    assert.ok(accessor.min[1] > -0.15 && accessor.max[1] < 2.2, "height outside a human body (0–2 m)");
    assert.ok(Math.abs(accessor.min[0]) < 1.5 && Math.abs(accessor.max[2]) < 1.5, "body is not centred on the origin");
  }
});

test("the licence travels with the asset (CC BY 4.0 needs attribution)", () => {
  assert.match(attribution, /BodyParts3D/i);
  assert.match(attribution, /CC BY 4\.0/i);
  assert.match(attribution, /creativecommons\.org\/licenses\/by\/4\.0/);
  assert.match(viewer, /CC BY 4\.0/);
  assert.match(viewer, /lifesciencedb\.jp|BodyParts3D/);
  assert.match(builder, /BodyParts3D/i);
});

test("the crash that broke the screen cannot come back", () => {
  // "Cannot read properties of undefined (reading 'traverse')": meshes were moved to another
  // parent *while* the loaded scene was still being traversed.
  assert.match(viewer, /loadedMeshes\.push\(node\)/, "meshes must be collected first");
  assert.match(viewer, /for \(const node of loadedMeshes\)/, "…then attached in a second pass");
  assert.doesNotMatch(viewer, /traverse\(\(node: any\) => \{ if \(node\.isMesh\) attach\(/, "the old traverse-and-move loop is back");
  assert.match(viewer, /const loadedMeshes: any\[\] = \[\]/);
});

test("a tap looks through the see-through muscles at the bone or organ", () => {
  assert.match(viewer, /return group === "muscles" \? 2 : group === "vessels" \? 1 : 0/,
    "bone/organ must win over muscle and thin vessels");
  assert.match(viewer, /hits\.slice\(\)\.sort/, "hits must be ranked, not taken in raw order");
  assert.match(viewer, /opacity = 0\.32/);
  assert.match(viewer, /depthWrite = false/);
  assert.match(viewer, /_partid/);
  assert.match(viewer, /Raycaster/);
  assert.match(viewer, /getX\(hit\.face\.a\)/);
});

test("the viewers stay lazy and can fall back to a list", () => {
  assert.match(viewer, /import\("three"\)/, "three.js must stay lazy-loaded");
  assert.match(viewer, /anatomy\/body\.glb/);
  assert.match(viewer, /wifiOnly\(\)/, "mobile-data users must be asked before a 6 MB download");
  assert.match(viewer, /computeVertexNormals/, "the file ships without normals to save ~2 MB");
  assert.match(viewer, /dispose\(\)/, "the WebGL context must be released when leaving the tab");
  assert.match(viewer, /Or pick from the list/, "no WebGL must not mean no report");
});

test("the screen never pretends to diagnose and always offers the emergency number", () => {
  assert.match(viewer, /999/);
  assert.match(viewer, /not a diagnostic image/i);
  assert.match(viewer, /not a diagnosis/i);
});

test("a patient can only send a pain report to a real doctor", () => {
  const route = routes.slice(routes.indexOf('router.post("/pain-reports"'));
  const body = route.slice(0, route.indexOf("}));") + 4);
  assert.match(body, /auth,allow\("patient"\)/);
  assert.match(body, /role:"doctor",status:"active"/);
  assert.match(body, /checkRedFlags\(/);
  assert.match(body, /notify\(doctor\._id/);
  assert.match(models, /model\("PainReport"/);
  assert.match(models, /bodyPart:/);
});

test("only the addressed doctor can acknowledge a report", () => {
  const route = routes.slice(routes.indexOf('router.post("/pain-reports/:id/acknowledge"'));
  const body = route.slice(0, route.indexOf("}));") + 4);
  assert.match(body, /allow\("doctor"\)/);
  assert.match(body, /doctorId:req\.user\.id/);
  assert.match(body, /notify\(report\.patientId/);
});

test("booking an appointment can carry the pain site from the 3D body", () => {
  assert.match(models, /painSite:\{name:/, "the appointment must be able to store the spot");
  const route = routes.slice(routes.indexOf('router.post("/appointments"'));
  const body = route.slice(0, route.indexOf("}));") + 4);
  assert.match(body, /painSite:z\.object/);
  assert.match(body, /painSite\}/, "the validated spot must be saved with the appointment");
  assert.match(body, /pain marked at/, "the doctor's notification must say where it hurts");
  const patient = read("apps/web/src/PatientPanel.tsx");
  assert.match(patient, /<PainSiteField/);
  assert.match(patient, /painSite \? \{ painSite \}/);
  assert.match(read("apps/web/src/DoctorPanel.tsx"), /Pain marked at/);
});

test("patient and doctor panels both expose the body map", () => {
  assert.match(read("apps/web/src/PatientPanel.tsx"), /<BodyMapCard/);
  assert.match(read("apps/web/src/DoctorPanel.tsx"), /<DoctorBodyReports/);
  assert.match(read("apps/web/src/common.tsx"), /bodypain/, "new reports should show a badge");
  assert.match(read("apps/web/src/anatomy.tsx"), /onOpenBodyMap/, "the anatomy tab must point at the real model");
});
