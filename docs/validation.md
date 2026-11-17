# Validation

Validated locally on 2026-11-17 with Windows, Python 3.11, PyTorch 2.7.1+cpu, torchvision 0.22.1, transformers 4.53.3 and timm 1.0.31. The development virtual environment reused the machine's installed Torch packages; a fresh-machine setup has not been independently tested.

## Automated checks

`python -m unittest discover -s tests -v`: **21 tests passed**. Coverage includes analytic IoU, one-to-one matching, threshold boundaries, AP/precision differences, label mapping, undefined AP without ground truth, invalid boxes/scores, image deduplication, local request guards, inference caching, cross-image rejection, stored-plan execution and explicit model/LLM validation failures. API tests use a fixture detector, not a real model.

`node --check web/app.js`: JavaScript syntax validation. GitHub Actions is configured for Windows/Linux and Python 3.11/3.12; configuration alone does not establish a successful remote run.

## Real inference and browser checks

- Official pinned Grounding DINO Tiny loaded on CPU. Two sample prompts ran in approximately 10.3 s and 8.2 s, excluding model loading. These single-image timings are observations on this machine, not benchmarks.
- The browser's template Agent completed a three-prompt local inference job and saved its comparison/report trace.
- Desktop and narrow-screen layouts inspected with real outputs, including the dark/light palettes and image comparison controls. No horizontal page overflow at a 390 px viewport.
- Model outputs are in `examples/sample-runs.json`. Approximate annotations are separate and explicitly labeled.
- After restarting the server, the updated template plan completed with two cache hits and one new inference. The pinned model loaded from local files without a download event.
- Annotation upload opened the evaluation dialog; a complete experiment JSON downloaded and parsed successfully. Browser console inspection returned no errors or warnings.

## Not established

No live external LLM provider, Base weights, CUDA inference, macOS real inference, large dataset benchmark, or multiuser/public deployment was tested. There is no claim of state-of-the-art accuracy. A detector score or a correspondence count does not establish semantic correctness.
