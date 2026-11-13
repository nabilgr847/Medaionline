// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Builds the compact full-body models used by the 3D body / pain map screen.
//
// Source: BodyParts3D 4.0 (Database Center for Life Science, Japan) — CC BY 4.0, prepared for
// the web by Human Atlas / Dagno (github.com/dagno-labs/anatomy-model, also CC BY 4.0).
// CC BY 4.0 allows commercial use and modification; it does NOT remove the attribution, so
// ATTRIBUTION.md is written next to the model and linked from the app.
//
// What this script does:
//   1. downloads the prepared pack (atlas.json + gzipped chunks) once, into a cache folder
//   2. keeps the whole body a patient can point at: skeleton, organs, muscles, blood vessels
//   3. simplifies every heavy mesh with meshoptimizer (harder for muscles/vessels)
//   4. writes one glb per layer + one small JSON that maps a picked vertex back to an
//      anatomical name (part ids are global across all layers)
//
// Run:  node scripts/anatomy/build-anatomy-model.mjs
// Out:  apps/web/public/anatomy/body.glb, body.parts.json, ATTRIBUTION.md
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createReadStream } from "node:fs";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../..");
const cache = join(repo, ".cache/anatomy-model");
const outDir = join(repo, "apps/web/public/anatomy");
const SOURCE = "https://codeload.github.com/dagno-labs/anatomy-model/tar.gz/refs/heads/main";

// meshoptimizer lives in the web app's devDependencies; this script runs from the repo root.
const requireFromWeb = createRequire(join(repo, "apps/web/package.json"));
const meshoptimizerPath = requireFromWeb.resolve("meshoptimizer");
const { MeshoptSimplifier } = await import(pathToFileURL(meshoptimizerPath).href);

// ONE complete body: bones + organs + muscles + blood vessels in a single file.
// Splitting it into layers saved bandwidth, but the patient could not see one whole body,
// and a pain map has to show the body the person is looking at. One file, one download.
const LAYERS = [
  {
    file: "body.glb",
    layer: "body",
    title: "full body",
    systems: ["skeletal", "cardiac", "respiratory", "digestive", "urinary", "endocrine", "reproductive", "sensory", "nervous", "muscular", "arterial", "venous"],
  },
];
const KEEP_NERVOUS = /brain|spinal cord/i;
/** Muscles and vessels are mostly smooth tubes: they survive far harder simplification. */
const RATIO_BY_SYSTEM = {
  // Muscle sheets are smooth and overlap: a flat budget keeps the layer under ~1 MB.
  muscular: (triangles) => (triangles < 120 ? 1 : 0.12),
  arterial: (triangles) => (triangles < 120 ? 1 : 0.11),
  venous: (triangles) => (triangles < 120 ? 1 : 0.11),
};
const ratioFor = (system, triangles) => RATIO_BY_SYSTEM[system]?.(triangles)
  ?? (triangles > 2000 ? 0.12 : triangles > 500 ? 0.2 : triangles > 150 ? 0.38 : 1);
/**
 * BodyParts3D muscle/vessel sheets are non-manifold, so the strict simplifier stops at ~50 %
 * and leaves the layer at 8 MB. "Permissive" collapses across those seams and reaches the
 * budget; it is only used for the two optional overlay layers, never for bones or organs.
 */
const flagsFor = (system) => (["muscular", "arterial", "venous"].includes(system) ? ["Permissive"] : ["LockBorder"]);

const COLORS = {
  skeletal: [0xef, 0xe9, 0xdc],
  cardiac: [0xc0, 0x39, 0x2b],
  respiratory: [0xe9, 0x8b, 0xa0],
  digestive: [0xd9, 0xa0, 0x5b],
  urinary: [0x9c, 0x6b, 0x4a],
  endocrine: [0x7c, 0x5c, 0xbf],
  reproductive: [0xb0, 0x7a, 0xa1],
  sensory: [0x2f, 0x6d, 0xb5],
  nervous: [0xf0, 0xa9, 0xb8],
  muscular: [0xc9, 0x77, 0x6f],
  arterial: [0xd9, 0x3a, 0x33],
  venous: [0x3f, 0x63, 0xb8],
};

function fetchSource() {
  const manifest = join(cache, "model/atlas.json");
  if (existsSync(manifest)) return join(cache, "model");
  mkdirSync(cache, { recursive: true });
  const tarball = join(cache, "pack.tar.gz");
  console.log("Downloading the prepared BodyParts3D pack (~33 MB)…");
  execFileSync("curl", ["-sL", "--max-time", "600", "-o", tarball, SOURCE], { stdio: "inherit" });
  execFileSync("tar", ["xzf", tarball, "-C", cache, "--strip-components=1", "anatomy-model-main/model"]);
  rmSync(tarball, { force: true });
  if (!existsSync(manifest)) throw new Error("atlas.json was not found in the downloaded pack");
  return join(cache, "model");
}

/** Runs on a list of triangle indices; keeps vertex order so normals stay valid. */
function simplify(positions, indices, targetRatio, flags = ["LockBorder"]) {
  if (targetRatio >= 0.999) return { indices, ratio: 1 };
  // meshopt requires the target index count to be a multiple of 3 (whole triangles).
  const targetTriangles = Math.max(8, Math.floor(((indices.length / 3) * targetRatio) / 3) * 3);
  const target = Math.min(indices.length, targetTriangles * 3);
  const [simplified] = MeshoptSimplifier.simplify(indices, positions, 3, target, 0.05, flags);
  return { indices: simplified, ratio: simplified.length / indices.length };
}

/** Drops vertices that no surviving triangle references (simplification leaves many behind). */
function compact(positions, indices) {
  const remap = new Int32Array(positions.length / 3).fill(-1);
  const outPositions = [];
  const outIndices = new Uint32Array(indices.length);
  let count = 0;
  for (let i = 0; i < indices.length; i++) {
    const source = indices[i];
    if (remap[source] === -1) {
      remap[source] = count++;
      outPositions.push(positions[source * 3], positions[source * 3 + 1], positions[source * 3 + 2]);
    }
    outIndices[i] = remap[source];
  }
  return { positions: new Float32Array(outPositions), indices: outIndices, vertexCount: count };
}

function buildGlb(systems, layer, startId) {
  // Phones dislike many draw calls and 32-bit indices, so each system is split into
  // vertex runs of at most 65 000 vertices: one material per system, uint16 indices.
  const meshes = [];
  const parts = [];
  let partId = startId;

  for (const [system, partsOfSystem] of systems) {
    let current = null;
    const flush = () => { if (current && current.vertexCount) meshes.push(current); current = null; };
    const startMesh = () => ({
      system,
      positions: [],
      ids: [],
      indices: [],
      vertexCount: 0,
      indexCount: 0,
    });
    current = startMesh();

    for (const part of partsOfSystem) {
      parts.push({ id: partId, name: part.name, system, layer, conceptId: part.conceptId });
      if (current.vertexCount + part.vertexCount > 65000) flush();
      if (!current) current = startMesh();
      const base = current.vertexCount;
      for (const value of part.positions) current.positions.push(value);
      for (let v = 0; v < part.vertexCount; v++) current.ids.push(partId);
      for (const index of part.indices) current.indices.push(index + base);
      current.vertexCount += part.vertexCount;
      current.indexCount += part.indices.length;
      partId++;
    }
    flush();
  }

  return {
    nextId: partId,
    meshes: meshes.map((mesh) => ({
      system: mesh.system,
      positions: new Float32Array(mesh.positions),
      ids: new Uint16Array(mesh.ids),
      indices: new Uint16Array(mesh.indices),
      vertexCount: mesh.vertexCount,
      indexCount: mesh.indexCount,
    })),
    parts,
  };
}

function writeGlb(meshes, path) {
  const json = {
    asset: { version: "2.0", generator: "MedAI anatomy build (BodyParts3D 4.0, CC BY 4.0)" },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, i) => i) }],
    nodes: [],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };
  const bin = [];
  let offset = 0;

  const pushView = (typedArray, target) => {
    const buffer = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const padding = (4 - (buffer.length % 4)) % 4;
    const view = { buffer: 0, byteOffset: offset, byteLength: buffer.length };
    if (target) view.target = target;
    json.bufferViews.push(view);
    bin.push(buffer);
    if (padding) bin.push(Buffer.alloc(padding));
    offset += buffer.length + padding;
    return json.bufferViews.length - 1;
  };

  // one material per system, coloured by the palette above
  const materialIndex = new Map();
  for (const mesh of meshes) {
    if (materialIndex.has(mesh.system)) continue;
    const [r, g, b] = COLORS[mesh.system] || [0xcc, 0xcc, 0xcc];
    json.materials.push({
      name: mesh.system,
      pbrMetallicRoughness: {
        baseColorFactor: [r / 255, g / 255, b / 255, 1],
        metallicFactor: 0,
        roughnessFactor: mesh.system === "skeletal" ? 0.85 : 0.55,
      },
      doubleSided: true,
    });
    materialIndex.set(mesh.system, json.materials.length - 1);
  }

  meshes.forEach((mesh, i) => {
    const positions = mesh.positions;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < positions.length; v += 3) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], positions[v + a]);
        max[a] = Math.max(max[a], positions[v + a]);
      }
    }
    json.accessors.push({ bufferView: pushView(positions), componentType: 5126, count: mesh.vertexCount, type: "VEC3", min, max });
    const posAcc = json.accessors.length - 1;
    json.accessors.push({ bufferView: pushView(mesh.ids), componentType: 5123, count: mesh.vertexCount, type: "SCALAR" });
    const idAcc = json.accessors.length - 1;
    const indexComponent = mesh.indices instanceof Uint16Array ? 5123 : 5125;
    json.accessors.push({ bufferView: pushView(mesh.indices, 34963), componentType: indexComponent, count: mesh.indexCount, type: "SCALAR" });
    const idxAcc = json.accessors.length - 1;

    json.meshes.push({
      name: `${mesh.system}-${i}`,
      primitives: [{
        attributes: { POSITION: posAcc, _PARTID: idAcc },
        indices: idxAcc,
        material: materialIndex.get(mesh.system),
        mode: 4,
      }],
    });
    json.nodes.push({ name: `${mesh.system}-${i}`, mesh: i });
  });

  json.buffers.push({ byteLength: offset });
  const header = Buffer.alloc(12);
  const jsonBuffer = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPadding = (4 - (jsonBuffer.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBuffer, Buffer.alloc(jsonPadding, 0x20)]);
  const binBuffer = Buffer.concat(bin);

  header.writeUInt32LE(0x46546c67, 0);                 // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binBuffer.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);             // "JSON"
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBuffer.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);              // "BIN"
  writeFileSync(path, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binBuffer]));
}

async function main() {
  await MeshoptSimplifier.ready;
  const modelDir = fetchSource();
  const atlas = JSON.parse(readFileSync(join(modelDir, "atlas.json"), "utf8"));

  const chunks = atlas.chunks.map((chunk) => gunzipSync(readFileSync(join(modelDir, chunk.gzip))));
  const wantedSystems = new Set(LAYERS.flatMap((entry) => entry.systems));
  const wanted = atlas.parts.filter((part) => {
    const keep = wantedSystems.has(part.system) && (part.system !== "nervous" || KEEP_NERVOUS.test(part.name));
    // Tiny decorations (a single tooth, a small cartilage) cost more draw time than they teach.
    return keep && part.indexCount / 3 >= 140;
  });

  // Geometry is prepared once per part, then grouped per output file.
  const bySystem = new Map();
  let sourceTriangles = 0;
  for (const part of wanted) {
    const buffer = chunks[part.chunk];
    const positions = new Float32Array(buffer.buffer, buffer.byteOffset + part.positions, part.vertexCount * 3);
    const indices = new Uint32Array(buffer.buffer, buffer.byteOffset + part.indices, part.indexCount);
    const triangles = part.indexCount / 3;
    sourceTriangles += triangles;
    const simplified = simplify(new Float32Array(positions), new Uint32Array(indices), ratioFor(part.system, triangles), flagsFor(part.system));
    const geometry = compact(new Float32Array(positions), simplified.indices);
    const list = bySystem.get(part.system) || [];
    list.push({
      name: part.name,
      conceptId: part.conceptId,
      positions: geometry.positions,
      indices: geometry.indices,
      vertexCount: geometry.vertexCount,
    });
    bySystem.set(part.system, list);
  }

  mkdirSync(outDir, { recursive: true });
  const files = [];
  const allParts = [];
  let nextId = 0;
  let totalTriangles = 0;

  for (const entry of LAYERS) {
    const systems = entry.systems.filter((system) => bySystem.has(system)).map((system) => [system, bySystem.get(system)]);
    if (!systems.length) continue;
    const built = buildGlb(systems, entry.layer, nextId);
    nextId = built.nextId;
    const path = join(outDir, entry.file);
    writeGlb(built.meshes, path);
    const triangles = built.meshes.reduce((sum, mesh) => sum + mesh.indexCount / 3, 0);
    const bytes = readFileSync(path).length;
    totalTriangles += triangles;
    allParts.push(...built.parts);
    files.push({ file: entry.file, layer: entry.layer, title: entry.title, parts: built.parts.length, triangles, bytes });
    console.log(`${entry.file}: ${(bytes / 1048576).toFixed(2)} MB, ${triangles} triangles, ${built.parts.length} parts`);
  }

  writeFileSync(join(outDir, "body.parts.json"), JSON.stringify({
    source: "BodyParts3D 4.0 (CC BY 4.0), prepared by Human Atlas / Dagno",
    license: "CC BY 4.0 — see ATTRIBUTION.md",
    units: "metres, Y up, feet at y=0",
    sourceTriangles,
    triangles: totalTriangles,
    files,
    parts: allParts,
  }));
  // Layers from V3.14 are gone: remove them so an old copy cannot be served by the PWA cache.
  for (const stale of ["muscles.glb", "vessels.glb"]) rmSync(join(outDir, stale), { force: true });
  console.log(`total: ${(files.reduce((sum, f) => sum + f.bytes, 0) / 1048576).toFixed(2)} MB, ${totalTriangles} triangles from ${sourceTriangles}, ${allParts.length} parts`);

  writeFileSync(join(outDir, "ATTRIBUTION.md"), `# 3D anatomy model — attribution

The model in this folder (\`body.glb\` — the whole body in one file) is derived from
**BodyParts3D 4.0**:

> BodyParts3D, © The Database Center for Life Science, licensed under
> [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

- Source dataset: <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html>
- Prepared for the web by Human Atlas (<https://github.com/vinaysingh-05/human-atlas>) and
  Dagno (<https://github.com/dagno-labs/anatomy-model>), also under CC BY 4.0.
- Publication: Mitsuhashi et al. (2009), *BodyParts3D: 3D structure database for anatomical
  concepts*, <https://doi.org/10.1093/nar/gkn613>

## Changes made for MedAI Hospital
- Combined bones, organs, muscles and blood vessels into one file so the patient sees one
  whole body. Skin, connective tissue and most nerves were removed; the nervous system keeps
  the brain and spinal cord.
- Simplified every heavy mesh with meshoptimizer and dropped the tiny parts that no one can
  point at on a phone screen.
- Colours are per-system materials, not per-vertex colours (smaller file, sharper look).
- Packed each layer into one glTF binary with uint16 indices and a per-vertex part id;
  \`body.parts.json\` maps a picked vertex back to an anatomical name.
- Normals are not stored in the file (about 1 MB) and are computed on the device once.

CC BY 4.0 requires attribution, not permission: MedAI keeps this notice in the app
(*3D body → "Where this body model comes from"*) and ships this file with the models.
`);
}

main().catch((error) => { console.error(error); process.exit(1); });
