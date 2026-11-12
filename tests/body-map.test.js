// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Guards for the full-body 3D pain map: the shipped model, its licence trail, the
// patient → chosen doctor route, and the safety rules that must not drift.
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
const muscles = readGlb(join(ANATOMY, "muscles.glb"));
const vessels = readGlb(join(ANATOMY, "vessels.glb"));
const layerFiles = manifest.files || [];

test("the first download stays small enough for a phone", () => {
  // Before this guard the naive pack was 13 MB and the muscle layer alone was 7.6 MB.
  assert.ok(bytes <= 6 * 1024 * 1024, `body.glb is ${(bytes / 1048576).toFixed(1)} MB — trim it again`);
  assert.ok(muscles.bytes <= 3 * 1024 * 1024, `muscles.glb is ${(muscles.bytes / 1048576).toFixed(1)} MB`);
  assert.ok(vessels.bytes <= 3 * 1024 * 1024, `vessels.glb is ${(vessels.bytes / 1048576).toFixed(1)} MB`);
  const total = bytes + muscles.bytes + vessels.bytes;
  assert.ok(total <= 10 * 1024 * 1024, `all layers together are ${(total / 1048576).toFixed(1)} MB`);
  assert.ok(statSync(join(ANATOMY, "body.parts.json")).size < 400 * 1024);
});

test("layer 1 keeps bones, organs and the brain; muscles and vessels ship separately", () => {
  const bodyParts = parts.filter((p) => (p.layer || "body") === "body");
  const systems = new Set(bodyParts.map((p) => p.system));
  for (const keep of ["skeletal", "cardiac", "respiratory", "digestive", "urinary", "nervous"]) {
    assert.ok(systems.has(keep), `missing system: ${keep}`);
  }
  for (const drop of ["muscular", "arterial", "venous", "lymphatic", "integumentary", "connective"]) {
    assert.ok(!systems.has(drop), `${drop} must not be in the always-downloaded file`);
  }
  const brain = bodyParts.filter((p) => /brain|spinal cord/i.test(p.name));
  assert.ok(brain.length > 0, "the nervous system must be reduced to brain / spinal cord");

  // The optional layers are real, named and tagged so the UI can filter them.
  for (const [layer, system] of [["muscles", "muscular"], ["vessels", "arterial"], ["vessels", "venous"]]) {
    const list = parts.filter((p) => p.layer === layer && p.system === system);
    assert.ok(list.length > 0, `${layer} layer has no ${system} parts`);
    assert.ok(list.every((p) => typeof p.name === "string" && p.name.length > 2));
  }
  assert.deepEqual(layerFiles.map((f) => f.file).sort(), ["body.glb", "muscles.glb", "vessels.glb"]);
});

test("each layer file only carries its own systems", () => {
  const systemsOf = (fileJson) => fileJson.materials.map((m) => m.name).sort();
  assert.ok(systemsOf(glb).includes("skeletal"));
  assert.ok(!systemsOf(glb).includes("muscular"), "muscles must not be in the first download");
  assert.deepEqual(systemsOf(muscles.json), ["muscular"]);
  assert.deepEqual(systemsOf(vessels.json), ["arterial", "venous"]);
  assert.ok(muscles.json.meshes.length >= 1 && vessels.json.meshes.length >= 1);
});

test("every part id in the binary buffer points at a real anatomical name", () => {
  // Mirrored structures legitimately share a name (24 ribs, 33 vertebrae), so the id is what
  // identifies the spot; the name is what the doctor reads.
  for (const part of parts) {
    assert.ok(typeof part.name === "string" && part.name.trim().length >= 2, "every part needs a readable name");
    assert.ok(typeof part.system === "string" && part.system.length > 0, "every part belongs to a system");
  }
  assert.ok(new Set(parts.map((p) => p.name)).size > parts.length * 0.6, "too many parts share a name to be useful");
  let triangles = 0;
  for (const mesh of glb.meshes) {
    const primitive = mesh.primitives[0];
    const position = glb.accessors[primitive.attributes.POSITION];
    const ids = glb.accessors[primitive.attributes._PARTID];
    const indices = glb.accessors[primitive.indices];
    assert.equal(ids.componentType, 5123, "_PARTID must be uint16 to keep the file small");
    assert.equal(ids.count, position.count, "every vertex needs exactly one part id");
    // uint16 indices cost half of uint32 and must never overflow.
    assert.equal(indices.componentType, 5123, "indices must stay uint16 (meshes are chunked for this)");
    assert.ok(indices.max === undefined || indices.max < 65535);
    triangles += indices.count / 3;
  }
  assert.ok(triangles >= 60000, `only ${triangles} triangles — the body would look broken`);
  assert.ok(triangles <= 300000, `${triangles} triangles is more than a phone should render`);

  // Spot-check the buffer: decode the id attribute of the largest mesh.
  const mesh = glb.meshes.reduce((a, b) => (a.primitives[0].attributes._PARTID > b.primitives[0].attributes._PARTID ? a : b));
  const accessor = glb.accessors[mesh.primitives[0].attributes._PARTID];
  const view = glb.bufferViews[accessor.bufferView];
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const ids = new Uint16Array(bin.buffer, bin.byteOffset + start, Math.min(accessor.count, 4096));
  for (const id of ids) assert.ok(id < parts.length, `part id ${id} has no name`);
});

test("the model is in metres with the feet near zero, so tapping maps to a real body", () => {
  for (let i = 0; i < glb.meshes.length; i++) {
    const accessor = glb.accessors[glb.meshes[i].primitives[0].attributes.POSITION];
    assert.equal(accessor.type, "VEC3");
    assert.equal(accessor.componentType, 5126, "positions must be float32");
    assert.ok(accessor.min[1] > -0.15 && accessor.max[1] < 2.2, "height outside a human body (0–2 m)");
    assert.ok(accessor.max[1] - accessor.min[1] < 2.2);
    assert.ok(Math.abs(accessor.min[0]) < 1.5 && Math.abs(accessor.max[2]) < 1.5, "body is not centred on the origin");
  }
});

test("the licence travels with the asset (CC BY 4.0 needs attribution)", () => {
  assert.match(attribution, /BodyParts3D/i);
  assert.match(attribution, /CC BY 4\.0/i);
  assert.match(attribution, /creativecommons\.org\/licenses\/by\/4\.0/);
  assert.match(viewer, /CC BY 4\.0/, "the app itself must show the credit");
  assert.match(viewer, /lifesciencedb\.jp|BodyParts3D/);
  assert.match(builder, /BodyParts3D/i);
});

test("a patient can only send a pain report to a real doctor", () => {
  const route = routes.slice(routes.indexOf('router.post("/pain-reports"'));
  const body = route.slice(0, route.indexOf("}));") + 4);
  assert.match(body, /auth,allow\("patient"\)/, "must be patient-only and authenticated");
  assert.match(body, /role:"doctor",status:"active"/, "cannot be addressed to a patient or a suspended doctor");
  assert.match(body, /doctorId/, "the report has to name the doctor");
  assert.match(body, /checkRedFlags\(/, "text must still be screened for red flags");
  assert.match(body, /notify\(doctor\._id/, "the chosen doctor must be told");
  assert.match(models, /model\("PainReport"/);
  assert.match(models, /bodyPart:/);
  assert.match(models, /urgency:/);
});

test("only the addressed doctor can acknowledge a report", () => {
  const route = routes.slice(routes.indexOf('router.post("/pain-reports/:id/acknowledge"'));
  const body = route.slice(0, route.indexOf("}));") + 4);
  assert.match(body, /allow\("doctor"\)/);
  assert.match(body, /doctorId:req\.user\.id/, "another doctor's report must not be writable");
  assert.match(body, /notify\(report\.patientId/, "the patient must learn their doctor replied");
});

test("patient and doctor views are scoped, not a global list", () => {
  assert.match(routes, /router\.get\("\/pain-reports\/mine",auth,allow\("patient"\)/);
  assert.match(routes, /router\.get\("\/doctor\/pain-reports",auth,allow\("doctor"\)/);
  const admin = routes.slice(routes.indexOf('router.get("/admin/pain-reports"'));
  assert.match(admin.slice(0, 400), /allow\("admin"\)/);
});

test("the optional layers are lazy: nothing extra is fetched until the toggle is used", () => {
  assert.match(viewer, /anatomy\/muscles\.glb/);
  assert.match(viewer, /anatomy\/vessels\.glb/);
  assert.match(viewer, /loadLayer/);
  assert.match(viewer, /setExtraVisible/);
  assert.match(viewer, /transparent = true/, "muscles must be see-through or they hide the organs");
  // The first view must not import the layer files eagerly.
  const openBlock = viewer.slice(viewer.indexOf("async function buildBody"), viewer.indexOf("async function buildBody") + 4000);
  assert.equal((openBlock.match(/anatomy\/muscles\.glb/g) || []).length, 0,
    "the muscle file must be loaded from the toggle handler, not when the body opens");
});

test("the 3D anatomy tab points people at the real model", () => {
  assert.match(read("apps/web/src/anatomy.tsx"), /onOpenBodyMap/);
  assert.match(read("apps/web/src/PatientPanel.tsx"), /onOpenBodyMap=\{/);
});

test("the viewer picks the tapped spot from _PARTID, not from a pixel colour", () => {
  assert.match(viewer, /_partid/, "three.js lowercases the attribute name — reading _PARTID alone never matches");
  assert.match(viewer, /computeVertexNormals/, "the file ships without normals to save 1 MB");
  assert.match(viewer, /Raycaster/);
  assert.match(viewer, /getX\(hit\.face\.a\)/);
  assert.match(viewer, /wifiOnly\(\)/, "mobile-data users must be asked before a 4 MB download");
  assert.match(viewer, /import\("three"\)/, "three.js must stay lazy-loaded");
  assert.match(viewer, /anatomy\/body\.glb/);
});

test("the screen never pretends to diagnose and always offers the emergency number", () => {
  assert.match(viewer, /999/);
  assert.match(viewer, /not a diagnostic image/i);
  assert.match(viewer, /not a diagnosis|never a diagnosis|not a diagnostic/i);
  assert.match(viewer, /dispose\(\)/, "the WebGL context must be released when leaving the tab");
});

test("patient and doctor panels both expose the body map", () => {
  assert.match(read("apps/web/src/PatientPanel.tsx"), /<BodyMapCard/);
  assert.match(read("apps/web/src/DoctorPanel.tsx"), /<DoctorBodyReports/);
  assert.match(read("apps/web/src/common.tsx"), /bodypain/, "new reports should show a badge");
});
