// constants.js
// Shared constant data: supported MC versions/loaders, the Minecraft/Iris
// uniform set we simulate, and the shader pipeline stage order.

export const MC_VERSIONS = {
  '1.20.1': {
    label: '1.20.1',
    // Block/format quirks that differ between versions and can affect
    // which shader options exist. Kept small on purpose - extend as
    // real compatibility issues come up.
    blockEntityDataVersion: 3465,
  },
  '1.21.1': {
    label: '1.21.1',
    blockEntityDataVersion: 3955,
  },
};

export const SHADER_LOADERS = {
  iris: {
    label: 'Iris',
    modLoader: 'Fabric / Quilt',
    // Extra uniforms/features Iris exposes beyond base OptiFine format.
    // https://shaders.properties (Iris docs) - custom uniforms, IS_IRIS flag.
    extraDefines: ['IS_IRIS'],
    supportsCustomUniforms: true,
  },
  oculus: {
    label: 'Oculus',
    modLoader: 'Forge',
    // Oculus is the Forge port of Iris - same shader compatibility layer.
    extraDefines: ['IS_IRIS', 'IS_OCULUS'],
    supportsCustomUniforms: true,
  },
};

// Order in which gbuffer programs are tried for a given piece of world
// geometry, falling back down the list if a more specific program isn't
// present in the pack. This mirrors OptiFine/Iris fallback behaviour
// (e.g. gbuffers_terrain falls back to gbuffers_textured_lit, then
// gbuffers_basic).
export const GBUFFER_FALLBACKS = {
  terrain: ['gbuffers_terrain', 'gbuffers_textured_lit', 'gbuffers_textured', 'gbuffers_basic'],
  water: ['gbuffers_water', 'gbuffers_terrain', 'gbuffers_textured_lit', 'gbuffers_basic'],
  block: ['gbuffers_block', 'gbuffers_terrain', 'gbuffers_textured_lit', 'gbuffers_basic'],
  sky_sun: ['gbuffers_skytextured', 'gbuffers_textured', 'gbuffers_basic'],
  sky_basic: ['gbuffers_skybasic', 'gbuffers_basic'],
  entities: ['gbuffers_entities', 'gbuffers_textured_lit', 'gbuffers_basic'],
};

// composite/deferred passes are numbered composite, composite1..composite15
// (and deferred, deferred1..deferred15). We only look for ones that are
// actually present in the pack.
export const MAX_COMPOSITE_PASSES = 16;

// The uniforms we know how to supply values for. Anything referenced by a
// pack's GLSL that ISN'T in this list still gets declared (so compilation
// doesn't fail) but is bound to a harmless default (0, 1, or identity).
export const KNOWN_UNIFORMS = [
  // matrices
  'gbufferModelView', 'gbufferModelViewInverse',
  'gbufferProjection', 'gbufferProjectionInverse',
  'gbufferPreviousModelView', 'gbufferPreviousProjection',
  'shadowModelView', 'shadowModelViewInverse',
  'shadowProjection', 'shadowProjectionInverse',
  'normalMatrix',
  // camera / time
  'cameraPosition', 'previousCameraPosition',
  'frameTimeCounter', 'frameCounter', 'frameTime',
  'worldTime', 'worldDay', 'moonPhase',
  // sky / lighting
  'sunPosition', 'moonPosition', 'shadowLightPosition', 'upPosition',
  'sunAngle', 'shadowAngle', 'rainStrength', 'wetness', 'wetnessCustom',
  'skyColor', 'fogColor', 'fogDensity', 'fogStart', 'fogEnd',
  'screenBrightness', 'nightVision', 'blindness', 'darknessFactor',
  // screen
  'viewWidth', 'viewHeight', 'aspectRatio', 'near', 'far',
  // player/world state
  'isEyeInWater', 'eyeAltitude', 'eyeBrightness', 'eyeBrightnessSmooth',
  'entityId', 'blockEntityId', 'heldItemId', 'heldItemId2',
  'playerMood',
];

// Texture sampler names we bind to real GL textures/render targets.
// colortex0-15 are the general purpose G-buffer/composite targets,
// depthtex0-2 are depth copies, shadowtex/shadowcolor back the shadow
// pass, noisetex is a generated blue-noise-ish texture.
export const COLOR_TEX_COUNT = 8; // we allocate 8 of the possible 16 - enough for core passes
export const SAMPLER_NAMES = [
  ...Array.from({ length: COLOR_TEX_COUNT }, (_, i) => `colortex${i}`),
  'depthtex0', 'depthtex1', 'depthtex2',
  'shadowtex0', 'shadowtex1', 'shadowcolor0', 'shadowcolor1',
  'noisetex',
  // legacy gaux aliases some older packs still use for colortex4-7
  'gaux1', 'gaux2', 'gaux3', 'gaux4',
];

export const GAUX_ALIAS = { gaux1: 'colortex4', gaux2: 'colortex5', gaux3: 'colortex6', gaux4: 'colortex7' };

// Standard per-block-geometry samplers OptiFine/Iris bind automatically for
// gbuffer programs: the block atlas, the lightmap, and (if the pack ships
// them) PBR normal/specular maps for the current block texture.
// Note: the OptiFine/Iris atlas sampler `texture` gets renamed to
// `mc_Texture` by the translator to avoid colliding with GLSL ES 300's
// built-in texture() sampling function - see glsl-translator.js.
export const STANDARD_SAMPLERS = ['mc_Texture', 'lightmap', 'normals', 'specular'];
