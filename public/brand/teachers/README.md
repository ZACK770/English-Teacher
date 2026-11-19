# Pulse teacher artwork

The application renders these pre-generated PNGs, not SVG elements or SVG URLs.
Portraits retain the original deterministic name/voice variants, white line art
(`#f0f5ef`) and lime accents (`#c0f67d`) for the dark Pulse surfaces.

All PNGs are **@2x** their nominal display size (no separate `@2x` filename):

- `male-0`…`male-5`, `female-0`…`female-5`: 192×192 for 96×96 portraits or 42×42 badges.
- `voice-hero`: 640×540 for the landing illustration.
- `conversation`: 720×720 for the learner illustration.
- `listen`, `speak`, `repeat`: 60×60 for the landing method steps.

Breathing is CSS animation on the `<img>`, disabled for reduced motion. Portraits
must remain positioned above the learner card's decorative `::before` disc.
Teacher names have alt text; adjacent-copy illustrations use empty decorative alt.

Regenerate with `node scripts/generate-teacher-art.mjs` from the repository root.
The generator requires Sharp (only for regeneration, not building or running the
application). If Sharp is installed elsewhere, set `SHARP_MODULE` to its absolute
module path. Artwork source is embedded in that generator; no SVG is shipped to
the browser for these illustrations. Landing step artwork uses the project's
installed Lucide icons.
