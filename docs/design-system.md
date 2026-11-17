# PromptScope visual system

The user selected a professional visual editor: dark canvas, large comparison images, concise tools.

## Intent and domain

The user is a computer-vision researcher inspecting an inference experiment before changing prompts. The primary action is comparing spatial evidence. Domain concepts: image plane, bounding boxes, region correspondence, experiment trace, confidence threshold, semantic phrase. The visual reference is an image inspection instrument, not a marketing dashboard.

Natural colors: graphite monitor frame, neutral image surround, white tool labels, cool cyan annotation, warm amber comparison annotation. A reserved blue marks executable actions. No decorative gradients.

Signature: two synchronized image planes with cyan/amber boxes; switch to one shared plane for overlay correspondence. The A/B color pair continues through selectors, box labels, table marks and correspondence counters.

Rejected defaults: oversized headline → compact scene title; card stack before image → canvas first with side inspector; unstructured history → a dedicated experiment sidebar; decorative metric cards → compact correspondence strip.

## Tokens and components

- Canvas `#252a32`, shell `#30343b`, panel `#393f48`, raised `#464e59`. The user requested a brighter reading surface than the original near-black palette.
- Text `#f4f6fa`, secondary `#d0d6df`, muted `#b3bdca`.
- Action `#a5baff`, annotation A `#75dae4`, annotation B `#f4bd82`.
- Typeface: locally bundled Manrope for Latin UI, Microsoft YaHei / Noto Sans CJK SC fallback for Chinese, platform monospace for coordinates only.
- Type scale: 11 metadata, 12 controls, 14 body, 16 section, 22 page title. Essential controls never use 8–9px text.
- Four-pixel spacing grid. Experiment sidebar 248px; inspector 304px; stage takes remaining width.
- Single depth strategy: subtle surface shifts and low-opacity borders. No decorative drop shadows.
- Controls 36–40px desktop, 44px touch; 6px control radius, 10px modal radius.
- At <=1380px inspector follows the canvas in a two-column control region. At <=760px the experiment sidebar becomes a horizontal card strip; controls and images stack on narrow screens.
- Motion only on user-triggered changes, 160ms opacity/transform; respect reduced motion.
- Results analysis sits directly below the detection table in the main column. Surface `#3c4657`, next-step inset `#46536a`; 23px title, 17px summary (16px mobile), 16px recommendations, 1.95 body line height. Sidebar retains execution events and a link to the analysis.
- Each analysis identifies its task, prompt set and fixed comparison parameters. Changing A/B selectors does not recompute an existing report. Reports from another image are not shown as current-image findings.

## Skills used

- Anthropic frontend-design: subject-led hierarchy and restraint.
- Dammyjay93 interface-design: image-first product composition and consistent controls.
- Vercel web-design-guidelines: keyboard interaction, form labels, focus, responsive and empty states.

These are development references, not runtime dependencies.

## Experiment and API settings UI

Manual and Agent groups have separate sidebar tabs. Each execution creates a persistent group, even for cached detections. A/B options and exports are scoped to that group. Stars retain and prioritize groups; deletion moves them to a recoverable trash view.

The top API connection button opens a labeled dialog for provider, endpoint, model, key, thinking mode and effort. Saved keys are never filled back into the page. Provider changes clear the draft key; changing destinations never reuses a stored key. Controls share the editor surface tokens and remain usable in a narrow viewport.
