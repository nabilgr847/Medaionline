# MedAI Hospital V3.14 — Muscles + blood vessels, and a way to find the model

V3.13 shipped the full-body model (bones + organs). This release adds the two layers that were
left out, makes them **optional downloads**, and puts the model where people were looking for it.

## Three layers instead of one

| File | Content | Size | When it downloads |
|---|---|---|---|
| `body.glb` | bones, heart, lungs, digestive tract, kidneys, glands, eyes, brain + spinal cord | **4.00 MB** | when "Open the 3D body" is tapped |
| `muscles.glb` | 402 muscles — chest, abdomen, back, arms, legs, face, neck | **1.21 MB** | only when the *Muscles* chip is switched on |
| `vessels.glb` | 980 arteries + veins | **0.93 MB** | only when the *Blood vessels* chip is switched on |

All three come from the same **BodyParts3D 4.0 (CC BY 4.0)** pack — nothing new to license. The
attribution file and the in-app credit now name all three files.

### Why the layers are separate

Muscles alone are **656,120 source triangles** and, with the strict simplifier, refused to go
below ~50 % — the muscle layer was **7.6 MB** on its own. Two changes fixed that:

- **`Permissive` simplification for muscles and vessels only.** BodyParts3D muscle sheets are
  non-manifold, so the strict collapser stopped early; permissive mode reaches the budget
  (656 k → 78 k triangles) and is never used for bones or organs, which stay on `LockBorder`.
- **Separate files.** Someone who only wants to point at a bone never pays for 2 MB of muscle.

Measured: muscles **7.61 MB → 1.21 MB**, vessels **3.41 MB → 0.93 MB**, first download unchanged
at 4.00 MB, all three together **6.15 MB** (~3.3 MB gzipped).

### How it looks

- Muscles are drawn at **34 % opacity with `depthWrite` off**, so bones and organs stay visible
  inside the body — like an anatomy atlas peel-back, not a solid shell.
- Vessels are opaque (red arteries / blue veins) and thin, so they read as a tree over the organs.
- Tapping still reports the **nearest surface under the finger**; with muscles on, that is the
  muscle you touched, and the screen says so.
- Each chip shows its download size before you press it, and the mobile-data question is
  re-used from the 3D anatomy tab.

## Finding the model

The full-body map had its own tab, and people went looking for it under *3D anatomy* instead.
So:

- The **3D anatomy** tab now opens with a banner: "🫀 Real full-body model — tap the spot that
  hurts" and a button that jumps straight to the map.
- The map tab is renamed **"3D body & pain"** (was "Pain map → doctor").
- Both tabs share one data-saver preference (`ask before loading 3D on mobile data`).

## Flat list

Without WebGL (or when someone prefers a list) the dropdown now holds **all 1,960 parts**,
grouped as *Bones / Heart / Lungs / … / Muscle · muscular / Vessel · arterial* — still ~65 kB
gzipped, still enough to send a pain report.

## Tests

**100** (was 97). New guards: each layer file carries only its own systems, the muscle layer is
never in the first download, the layer files are referenced through the toggle handler (not
loaded when the body opens), muscles are transparent, and the 3D anatomy tab links to the map.
Size ceilings: body ≤ 6 MB, each overlay ≤ 3 MB, all layers ≤ 10 MB.

## Rebuild

```bash
node scripts/anatomy/build-anatomy-model.mjs   # writes all three glb files + parts json
```
