# mc-shader-preview

Preview Minecraft (Iris/Oculus) shaderpacks in the browser: upload a
`.zip`, see it rendered on a small block-world scene, tweak its own
settings live, and get a rough "how heavy is this" score. Pure static
site (HTML/CSS/JS + WebGL2 via Three.js) - no backend, no build step,
so it hosts directly on GitHub Pages.

## Running it

**Locally:** serve the folder over HTTP (ES modules don't load from
`file://`). Any static server works, e.g.:

```
npx serve .
# or
python3 -m http.server 8000
```

then open the printed localhost URL.

**On GitHub Pages:** push this folder to a repo, then in
*Settings → Pages* set the source to the branch/folder this lives in.
No build step - it's served as-is.

## How it works

- **`js/zip-reader.js`** unzips the uploaded pack (via JSZip from a CDN)
  into a flat `path -> source text` map, normalizing the "extra wrapper
  folder" case zip tools sometimes add.
- **`js/shader-options-parser.js`** scans every shader source file for
  the real OptiFine/Iris option syntax - `#define NAME value // comment
  [choices]` and `const type NAME = value; //[choices]` - plus
  `shaders.properties` for screen/grouping metadata, and builds a
  settings schema from it.
- **`js/glsl-translator.js`** rewrites a pack's desktop-GLSL source
  (legacy `attribute`/`varying`, `gl_FragColor`, `texture2D`,
  Minecraft-only uniforms) into valid WebGL2 GLSL ES (`#version 300
  es`), injecting real declarations for every Minecraft/Iris uniform
  and sampler the source references. This is the piece most worth
  reading if you want to see how the translation actually works - it's
  been checked against `glslangValidator` (a real GLSL compiler) on
  several representative fixtures in `test/fixtures/`, not just
  eyeballed.
- **`js/pipeline.js`** runs the actual render: one gbuffer pass (world
  geometry through the pack's `gbuffers_terrain`-family program, or a
  plain lit fallback if the pack doesn't have one or it fails to
  compile) into a multi-target buffer, then the pack's
  `composite`/`compositeN` passes in order as full-screen quads, then
  `final` (or a plain blit of the last composite output).
- **`js/heaviness-score.js`** is a static heuristic (no live
  benchmarking, per the current design decision): pass count, texture
  sample density, loop/branch counts, shadow map settings, and
  known-expensive-technique keywords (SSR, volumetric, TAA, PBR, POM,
  denoisers, voxel GI, ...), weighted and clamped to 1-100.
- **`js/world.js` / `js/textures.js`** build the preview scene (hill,
  grass, flowers, flower pots, a short staircase, gradient skybox with
  a moving sun/moon) with textures generated procedurally on canvas at
  runtime - original pixel art, not Minecraft's actual assets, so
  there's nothing here that needs Mojang's textures to run.

## Current scope (v1 = "real GLSL, core passes first")

Working now:
- Real parsing of a pack's options (inline defines + shaders.properties
  grouping) into a live settings panel; boolean/dropdown/const options
  all apply back into the shader source and (for `const` options)
  trigger a real recompile.
- Real GLSL translation + compilation for `gbuffers_terrain` (with the
  usual fallback chain to `gbuffers_textured_lit` → `gbuffers_textured`
  → `gbuffers_basic`), `composite`/`composite1..15`, and `final`.
- Static heaviness scoring with a visible breakdown, not just a number.

Not wired up yet (falls back gracefully rather than breaking):
- The **shadow pass** - `shadowtex`/`shadowcolor` samplers are declared
  so packs still compile, but they're bound to a blank texture, which
  reads as "no shadows" rather than a real shadow map. This is the
  biggest visible gap versus a real client.
- Non-terrain gbuffers programs (`gbuffers_water`, `gbuffers_entities`,
  `gbuffers_skytextured`, etc.) - everything currently renders through
  the terrain program's fallback chain. The skybox itself still uses a
  simple built-in gradient shader rather than a translated
  `gbuffers_skybasic`/`skytextured`.
- `deferred`/`deferredN` passes are recognized by the heaviness scorer
  but not yet run in the pipeline (only `composite*`/`final` are).
- Per-vertex lightmap (`vaUV1`) is currently a flat "fully lit" value -
  there's no real block/sky light propagation through the block world
  yet, so shaders that lean heavily on lightmap-driven lighting will
  look flatter than in-game.

None of these are architectural dead ends - the translator and pipeline
are built so adding a program type is "point it at the right `.fsh`/
`.vsh` pair and wire up its render target," not a redesign.

## A note on testing

The parser, translator, and heaviness scorer were each tested directly
(Node + synthetic OptiFine-style fixtures in `test/fixtures/`, with the
translator's output additionally validated against `glslangValidator`,
a real GLSL compiler) - those results are in `test/`. The Three.js/WebGL
side (the actual in-browser render) has **not** been run in a live
browser yet, since this was built in a sandboxed environment without
one. It's built consistently with current Three.js APIs, but expect to
hit and fix real runtime issues on the first load - normal for a
project this size at the "full skeleton" stage.

## License / asset note

No Minecraft or Mojang assets are included or required - all block/
plant textures are generated procedurally at runtime (see
`js/textures.js`).
