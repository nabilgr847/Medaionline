# MedAI Hospital V3.15 — The 3D body opens again, as one whole body, and comes with the appointment

## 1. The bug you saw

> **"The 3D view did not open. Cannot read properties of undefined (reading 'traverse')"**

Root cause: after the model loaded, the screen walked the loaded scene and **moved each mesh into
another parent while still walking it**. three.js keeps an index into `children` (`children[i]`),
so removing an item mid-loop made the next step read `undefined.traverse` — exactly that message.
It was introduced with the V3.14 muscle/vessel layers (my Node check hit the same error and I
missed that it also affected the screen).

Fix: **collect the meshes first, then attach them** — one traversal, no mutation during it. There is
now a test whose only job is to keep that pattern from coming back.

## 2. One whole body, one file — as you asked

V3.14 split the body into three downloads. That made the patient hunt for the body, so the layers
are merged back:

| | |
|---|---|
| File | `anatomy/body.glb` — **6.15 MB** (~3.6 MB over the wire) |
| Parts | **1,960** named structures |
| Triangles | 332,904 (from 1,980,626 source triangles) |
| Layers inside | bones · organs (heart, lungs, gut, kidneys, glands, eyes, brain + cord) · **402 muscles** · **980 arteries + veins** |

- Muscles are drawn at **32 % opacity with `depthWrite` off**, so the skeleton and organs are
  visible *inside* the body — a full body that you can still see into.
- A tap is **ranked**: bones and organs win over the thin vessels, which win over muscle. So a tap
  on the chest reports the sternum, not the muscle in front of it. Hide **Muscles** in the chips
  if you want to touch bones directly.
- Everything is switched by four chips: **Bones · Organs · Muscles · Blood vessels**.
- The first download still asks before using mobile data, and the flat list of all 1,960 parts is
  still there for phones without WebGL.

## 3. The 3D body now travels with an appointment

Request an appointment → **"📍 Mark the exact spot of pain on the 3D body (optional)"**:

- the same body opens inline (compact), you tap the spot and set a 1–10 score;
- the booking is saved with `painSite { name, partId, system, severity }` on the appointment;
- the doctor sees **"📍 Pain marked at Left femur · 7/10"** in *New requests* and in every
  appointment card;
- the appointment notification email/push copy also names the spot.

`POST /appointments` now validates and stores it (zod: name 2–160 chars, severity 1–10).

## 4. Tests

**99 / 99.** New guards include: the traverse crash cannot return, taps are ranked so muscles and
vessels do not swallow them, one file carries all nine systems, uint16 index safety, part-id → name
integrity, metres/feet-at-zero bounds, CC BY 4.0 attribution in the asset *and* the UI, doctor-only
acknowledgement scoping, red-flag screening for text, and the appointment `painSite` path end to end
(model → route → notification → both panels).

## 5. Still needed on your side

Render → **Medaionline** → *Manual Deploy* (clear build cache) so `/api/pain-reports` and the new
appointment field exist. Until then the map opens but sending a report returns 404.
