# ElevenLabs UI Orb notice

`ElevenLabsOrb.tsx` is adapted from the official ElevenLabs UI Orb registry
component (`https://ui.elevenlabs.io/r/orb.json`), documented as MIT-licensed.
The shader logic is unchanged; zerOS stores the referenced Perlin texture
locally and adds an explicit inversion input so the orb remains legible on the
console's black stage. zerOS also supplies its own container, state mapping, and
lazy-loading boundary, plus a demand-render mode for reduced-motion users.

Retrieved: 2026-07-12.

Dash adaptation: the same fragment shader runs in a local WebGL2 canvas. GLSL input/output declarations change for WebGL2. The Perlin texture is downsampled to 128×128. Idle is still; phase and volume inputs come only from real voice state. No automatic random volume mode is used.
