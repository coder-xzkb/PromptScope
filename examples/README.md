# Example data

`sample-runs.json` contains genuine Grounding DINO Tiny outputs on the bundled NASA image, generated on CPU with `scripts/smoke_model.py`. Candidate score floor: 0.05; text threshold: 0.25. The sample browser view uses a separate 0.25 display threshold.

`annotations.json` is a **rough, manually specified teaching annotation**, not an official NASA/COCO annotation or a benchmark. It labels the visible person and the held helmet. The suit's neck ring is intentionally not labeled as a helmet, illustrating why high scores alone do not establish accuracy. Review and correct boxes before using this for any quantitative claim.

To try evaluation, load the NASA image, choose an A run, click “标注评估” and select `annotations.json`.
