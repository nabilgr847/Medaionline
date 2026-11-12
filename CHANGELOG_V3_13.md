# MedAI Hospital V3.13 — Full-body 3D pain map → chosen doctor

The question was simple: *"I have pain here"* — with the exact place on a real body, sent to a
specific doctor. This release does that, using an openly licensed anatomy model instead of a
purchased one, so there is no licence problem.

## The model

Real human anatomy, not invented spheres:

| | |
|---|---|
| Source | **BodyParts3D 4.0** — Database Center for Life Science (DBCLS), Japan |
| Licence | **CC BY 4.0** — commercial use and modification allowed, attribution required |
| Original | 2,234 parts · 2,288,268 triangles · ~33 MB pack |
| Shipped | 578 parts · 188,238 triangles · **4.0 MB** (`body.glb`, ~2 MB over the wire) |

How it was trimmed and rebuilt, in `scripts/anatomy/build-anatomy-model.mjs` (re-runnable,
download goes to `.cache/anatomy-model`, which is git-ignored):

- **Kept**: bones (skull, spine, ribs, arms, legs, hands, feet, teeth, discs) and the internal
  organs — heart, lungs/airway, digestive tract, kidneys/urinary, glands, reproductive, eyes,
  brain + spinal cord.
- **Dropped**: muscle sheets, arteries, veins, lymphatics, skin and connective tissue — that is
  where the 33 MB lived, and a pain map does not need them.
- **Simplified**: every mesh over 150 triangles was simplified with `meshoptimizer`
  (18 % of the original triangles for heavy meshes, more for small ones), and unused vertices
  were compacted away.
- **Packed for phones**: one GLB, one material per system, meshes split into 65 000-vertex
  chunks so indices stay **uint16**, and a custom `_PARTID` attribute per vertex so a tap can be
  turned back into an anatomical name. Normals are not stored (they cost ~1 MB) and are computed
  on the device once.
- `body.parts.json` (52 kB) maps part id → anatomical name + system, and `ATTRIBUTION.md` is
  shipped next to the model.

Credit is also visible **in the app** (collapsible "Where this body model comes from" block),
because CC BY requires it.

## What the patient does

1. Patient tab → **Pain map → doctor**.
2. "Open the 3D body" — three.js + GLTFLoader + the model are lazy-loaded, nothing downloads
   until this tap. On a metered connection the app asks first (same preference as the 3D anatomy
   tab), and the model is cached afterwards by the service worker.
3. Drag to rotate, pinch or scroll to zoom, and tap the spot that hurts. A red dot marks it and
   the anatomical name appears — the tap is resolved through a raycast and the `_PARTID`
   attribute, so overlapping bones/organs give the surface actually under the finger.
4. Say how bad it is (1–10), how long it has been there, add a note, and **choose one doctor**.
5. "Send this pain report."

Extras that matter on a real phone: layer toggles (bones/heart/lungs/… can be hidden),
rotate and zoom buttons next to the canvas, reset, a rotating idle animation that stops as soon
as the finger touches the screen (`prefers-reduced-motion` respected), and a **flat list of all
578 parts** so a phone without WebGL can still send a report.

## What the doctor does

New **Body-map reports** tab: patient, anatomical part, pain score, duration, note, and any
red-flag text, with a short reply box. Marking a report seen notifies the patient; a reply
appears in the patient's "My sent pain reports" list.

Red flags are screened by **rule** (`safety.js`, no AI): chest pain with sweating/breathlessness,
stroke signs, heavy bleeding, fainting. The result is attached to the report and shown to both
sides — and every screen says emergencies mean **call 999**, not wait for an online reply.

## Honesty and safety

- "It is a learning and communication aid, not a diagnostic image. Your doctor still examines you."
- The feature is a route to a doctor, never a diagnosis.
- Only the addressed doctor can open or answer a report; patients only ever see their own.
- Every send is written to the audit log.

## Tests

**97** (11 new in `tests/body-map.test.js`): GLB container and size ceiling, uint16 index safety,
part-id → name integrity, metres/feet-at-zero bounds, licence text in the asset *and* the UI,
doctor-only acknowledgement scoping, patient/doctor list scoping, red-flag screening, lazy load,
`_partid` casing, `computeVertexNormals`, WebGL disposal, and the 999 copy.

## Rebuild the model

```bash
npm i -D meshoptimizer --prefix apps/web      # already a devDependency
node scripts/anatomy/build-anatomy-model.mjs  # writes apps/web/public/anatomy/*
```
