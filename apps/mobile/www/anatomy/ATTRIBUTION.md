# 3D anatomy model — attribution

The model in this folder (`body.glb`) is derived from **BodyParts3D 4.0**:

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
  added `body.parts.json` which maps a picked triangle back to an anatomical name.

CC BY 4.0 requires attribution, not permission: MedAI keeps this notice in the app
(*3D anatomy → About this model*) and ships this file with the model.
