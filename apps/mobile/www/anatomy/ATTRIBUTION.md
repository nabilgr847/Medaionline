# 3D anatomy model — attribution

The model in this folder (`body.glb` — the whole body in one file) is derived from
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
  `body.parts.json` maps a picked vertex back to an anatomical name.
- Normals are not stored in the file (about 1 MB) and are computed on the device once.

CC BY 4.0 requires attribution, not permission: MedAI keeps this notice in the app
(*3D body → "Where this body model comes from"*) and ships this file with the models.
