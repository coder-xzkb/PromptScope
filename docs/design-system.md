# PromptScope visual system

The user selected a professional visual editor: dark canvas, large comparison images, concise tools.

## Intent and domain

The user is a computer-vision researcher inspecting an inference experiment before changing prompts. The primary action is comparing spatial evidence. Domain concepts: image plane, bounding boxes, region correspondence, experiment trace, confidence threshold, semantic phrase. The visual reference is an image inspection instrument, not a marketing dashboard.

Natural colors: graphite monitor frame, neutral image surround, white tool labels, cool cyan annotation, warm amber comparison annotation. A reserved blue marks executable actions. No decorative gradients.

Signature: two synchronized image planes with cyan/amber boxes; switch to one shared plane for overlay correspondence. The A/B color pair continues through selectors, box labels, table marks and correspondence counters.

Rejected defaults: oversized headline → compact scene title; card stack before image → canvas first with side inspector; permanent wide navigation → narrow asset rail; decorative metric cards → compact correspondence strip.

## Tokens and components

- Canvas `#111113`, shell `#1b1b1e`, panel `#232326`, raised `#2c2c30`.
- Text `#eeeef0`, secondary `#b5b5bd`, muted `#92929d`.
- Action `#a5baff`, annotation A `#75dae4`, annotation B `#f4bd82`.
- Typeface: locally bundled Manrope for Latin UI, Microsoft YaHei / Noto Sans CJK SC fallback for Chinese, platform monospace for coordinates only.
- Type scale: 11 metadata, 12 controls, 14 body, 16 section, 22 page title. Essential controls never use 8–9px text.
- Four-pixel spacing grid. Rail 72px; inspector 304px; stage takes remaining width.
- Single depth strategy: subtle surface shifts and low-opacity borders. No decorative drop shadows.
- Controls 36–40px desktop, 44px touch; 6px control radius, 10px modal radius.
- At <=1100px inspector follows the canvas in a two-column control region. At <=700px controls and images stack; rail becomes an image strip.
- Motion only on user-triggered changes, 160ms opacity/transform; respect reduced motion.

## Skills used

- Anthropic frontend-design: subject-led hierarchy and restraint.
- Dammyjay93 interface-design: image-first product composition and consistent controls.
- Vercel web-design-guidelines: keyboard interaction, form labels, focus, responsive and empty states.

These are development references, not runtime dependencies.
