# MedAI Hospital V3.12 — 3D anatomy: six organs, labels, quiz

## More organs
`Heart`, `Lungs`, `Brain` are joined by **Kidney**, **Eye** and **Spine** — still built from
simple geometry, so nothing extra is downloaded beyond three.js itself.

- Kidney: a real bean shape, made by pulling one side of a sphere inwards (no CSG library).
- Eye: sclera, iris, pupil, a slightly transparent cornea and the optic nerve behind.
- Spine: 24 vertebrae with discs, following a gentle S curve, plus spinous processes.

## Labels that follow the model
Each organ carries 3–4 **hotspots** (Aorta, Right atrium, Renal pelvis, Lens, Lumbar…). Their
anchors are projected to the screen every frame, so a label stays glued to the correct point
while the model turns. Points on the far side are hidden (dot product against the camera), so
you never see a label through the organ.

- "Show labels" toggle (on by default).
- On a phone the labels collapse to 44 px dots — the name appears in the note card instead.
- Tapping a dot opens a short explanation with a Close button.

## Quiz
- 4 questions per organ (24 in total), each with a one-line explanation after answering.
- Score at the end, best score per organ remembered on the device.

## Unchanged (deliberately)
- three.js is still a **lazy chunk** — 753 kB downloaded only when "Open 3D view" is tapped.
- "Ask before loading 3D on mobile data" is still on by default.
- Without WebGL the card explains the organ in words instead of failing.
- Caption still says these are teaching pictures, not diagnostic images.

Tests: **86** (six new guards for organ content, quiz answers, labels and visibility).
