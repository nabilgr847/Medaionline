// © 2026 MD Gausur Rahman Nabil. All rights reserved. MedAI Hospital.
// Builds the compact full-body model used by the "3D anatomy" tab.
//
// Source: BodyParts3D 4.0 (Database Center for Life Science, Japan) — CC BY 4.0, prepared for
// the web by Human Atlas / Dagno (github.com/dagno-labs/anatomy-model, also CC BY 4.0).
// CC BY 4.0 allows commercial use and modification; it does NOT remove the attribution, so
// ATTRIBUTION.md is written next to the model and linked from the app.
//
// What this script does:
//   1. downloads the prepared pack (atlas.json + gzipped chunks) once, into a cache folder
//   2. keeps the systems a patient can point at (skeleton + organs), drops muscles,
//      blood vessels and the skin, which only slowed the phone down
//   3. simplifies every heavy mesh with meshoptimizer
//   4. writes ONE glb (about 150k triangles) + a small JSON that maps a picked triangle to
//      an anatomical name
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

const KEEP = new Set(["skeletal", "cardiac", "respiratory", "digestive", "urinary", "endocrine", "reproductive", "sensory"]);
const KEEP_NERVOUS = /brain|spinal cord/i;

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
function simplify(positions, indices, targetRatio) {
  if (targetRatio >= 0.999) return { indices, ratio: 1 };
  // meshopt requires the target index count to be a multiple of 3 (whole triangles).
  const targetTriangles = Math.max(8, Math.floor(((indices.length / 3) * targetRatio) / 3) * 3);
  const target = Math.min(indices.length, targetTriangles * 3);
  const [simplified] = MeshoptSimplifier.simplify(indices, positions, 3, target, 0.05, ["LockBorder"]);
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

function buildGlb(systems) {
  // Phones dislike many draw calls and 32-bit indices, so each system is split into
  // vertex runs of at most 65 000 vertices: one material per system, uint16 indices.
  const meshes = [];
  const parts = [];
  let partId = 0;

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
      parts.push({ id: partId, name: part.name, system, conceptId: part.conceptId });
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
  const wanted = atlas.parts.filter((part) => {
    const keep = KEEP.has(part.system) || (part.system === "nervous" && KEEP_NERVOUS.test(part.name));
    // Tiny decorations (a single tooth, a small cartilage) cost more draw time than they teach.
    return keep && part.indexCount / 3 >= 140;
  });

  const bySystem = new Map();
  let sourceTriangles = 0;
  for (const part of wanted) {
    const buffer = chunks[part.chunk];
    const positions = new Float32Array(buffer.buffer, buffer.byteOffset + part.positions, part.vertexCount * 3);
    const indices = new Uint32Array(buffer.buffer, buffer.byteOffset + part.indices, part.indexCount);
    const triangles = part.indexCount / 3;
    sourceTriangles += triangles;
    const ratio = triangles > 2000 ? 0.12 : triangles > 500 ? 0.2 : triangles > 150 ? 0.38 : 1;
    const simplified = simplify(new Float32Array(positions), new Uint32Array(indices), ratio);
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

  const { meshes, parts } = buildGlb([...bySystem.entries()]);
  mkdirSync(outDir, { recursive: true });
  writeGlb(meshes, join(outDir, "body.glb"));

  const triangles = meshes.reduce((sum, m) => sum + m.indexCount / 3, 0);
  writeFileSync(join(outDir, "body.parts.json"), JSON.stringify({
    source: "BodyParts3D 4.0 (CC BY 4.0), prepared by Human Atlas / Dagno",
    license: "CC BY 4.0 — see ATTRIBUTION.md",
    units: "metres, Y up, feet at y=0",
    sourceTriangles,
    triangles,
    parts,
  }));

  writeFileSync(join(outDir, "ATTRIBUTION.md"), `# 3D anatomy model — attribution

The model in this folder (\`body.glb\`) is derived from **BodyParts3D 4.0**:

> BodyParts3D, © The Database Center for Life Science, licensed under
> [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

- Source dataset: <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html>
- Prepared for the web by Human Atlas (<https://github.com/vinaysingh-05/human-atlas>) and
  Dagno (<https://github.com/dagno-labs/anatomy-model>), also under CC BY 4.0.
- Publication: Mitsuhashi et al. (2009), *BodyParts3D: 3D structure database for anatomical
  concepts*, <https://doi.org/10.1093/nar/gkn613>

## Changes made for MedAI Hospital
- Kept the skeleton and the organs a patient can point at; removed muscles, blood vessels,
  the body surface and most nerves (they made the download too large for a phone).
- Simplified heavy meshes with meshoptimizer.
- Packed everything into one glTF binary with vertex colours and a per-vertex part id, and
  added \`body.parts.json\` which maps a picked triangle back to an anatomical name.

CC BY 4.0 requires attribution, not permission: MedAI keeps this notice in the app
(*3D anatomy → About this model*) and ships this file with the model.
`);

  const size = readFileSync(join(outDir, "body.glb")).length;
  console.log(`body.glb: ${(size / 1048576).toFixed(2)} MB, ${Math.round(triangles)} triangles from ${Math.round(sourceTriangles)}`);
  console.log(`parts: ${parts.length}, systems: ${[...bySystem.keys()].join(", ")}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
