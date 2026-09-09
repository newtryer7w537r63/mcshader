// glsl-translator.js
//
// Real Iris/OptiFine shader packs target desktop OpenGL GLSL against
// Minecraft's fixed rendering pipeline (legacy `attribute`/`varying`,
// `gl_FragColor`, `texture2D`, and a long list of Minecraft-specific
// uniforms that don't exist in a generic WebGL context). This module
// rewrites a pack's source into valid WebGL2 GLSL ES (#version 300 es)
// so it can actually be compiled and run by the browser, and injects
// declarations (bound to real values where we track them, harmless
// defaults otherwise) for every Minecraft uniform/sampler the source
// references.
//
// Scope (matches the "core passes first" decision): gbuffers_*,
// composite/compositeN, and final programs. Shadow-pass-specific
// variables (shadowtex*, shadowcolor*) are declared but the shadow pass
// itself is a later addition - see pipeline.js.
//
// This is a source-rewrite, not a full parser - it's deliberately
// pattern-based so it's easy to extend as real-world packs expose gaps.
// Every unsupported construct we hit should get a comment + a TODO
// rather than silently mistranslating.

import { KNOWN_UNIFORMS, SAMPLER_NAMES, GAUX_ALIAS, STANDARD_SAMPLERS } from './constants.js';

const VERSION_RE = /^\s*#version\s+\d+.*$/m;

// Attribute names Minecraft's fixed-function pipeline used to provide
// automatically. We supply them as real `in` attributes fed from our
// own geometry buffers (see pipeline.js `ATTRIBUTE_LOCATIONS`).
const LEGACY_ATTRIBUTES = {
  gl_Vertex: { attrType: 'vec3', attribute: 'vaPosition', promote: 'vec4(vaPosition, 1.0)' },
  gl_Normal: { attrType: 'vec3', attribute: 'vaNormal', promote: 'vaNormal' },
  gl_Color: { attrType: 'vec4', attribute: 'vaColor', promote: 'vaColor' },
  gl_MultiTexCoord0: { attrType: 'vec2', attribute: 'vaUV0', promote: 'vec4(vaUV0, 0.0, 1.0)' },
  // lightmap coords (block/sky light) - packed into a second UV channel
  gl_MultiTexCoord1: { attrType: 'vec2', attribute: 'vaUV1', promote: 'vec4(vaUV1, 0.0, 1.0)' },
};

const LEGACY_MATRICES = {
  gl_ModelViewMatrix: 'gbufferModelView',
  gl_ProjectionMatrix: 'gbufferProjection',
  gl_ModelViewProjectionMatrix: '(gbufferProjection * gbufferModelView)',
  gl_NormalMatrix: 'mat3(gbufferModelView)',
};

function detectStage(filePath) {
  if (/\.vsh$/i.test(filePath)) return 'vertex';
  if (/\.fsh$/i.test(filePath)) return 'fragment';
  if (/\.gsh$/i.test(filePath)) return 'geometry';
  if (/\.csh$/i.test(filePath)) return 'compute';
  return 'fragment';
}

/** Apply the current settings' #define/const overrides to raw source text before translation. */
export function applyOptionOverrides(source, options, overrides) {
  let out = source;
  for (const opt of options) {
    if (!(opt.id in overrides)) continue;
    const value = overrides[opt.id];
    if (opt.source === 'define') {
      if (opt.kind === 'bool') {
        const enabled = value === 'true' || value === true;
        const definePattern = new RegExp(`^([ \\t]*)(//[ \\t]*)?(#define[ \\t]+${opt.id}\\b.*)$`, 'm');
        out = out.replace(definePattern, (m, indent, _commented, rest) =>
          `${indent}${enabled ? '' : '//'}${rest}`);
      } else {
        const definePattern = new RegExp(`(#define[ \\t]+${opt.id}[ \\t]+)([^\\n/]*)`, 'm');
        out = out.replace(definePattern, (m, prefix) => `${prefix}${value}`);
      }
    } else if (opt.source === 'const') {
      const constPattern = new RegExp(`(const[ \\t]+\\w+[ \\t]+${opt.id}[ \\t]*=[ \\t]*)([^;]+)(;)`, 'm');
      out = out.replace(constPattern, (m, prefix, _old, semi) => `${prefix}${value}${semi}`);
    }
  }
  return out;
}

// Legacy `shadow2D(sampler, vec3).r` (or .x/.rgb/etc) returns a vec4 in
// GLSL 120 that callers swizzle down to one component. GLSL ES 300's
// texture() on a sampler2DShadow returns a plain float already, so any
// trailing swizzle after the call must be dropped or it becomes an
// invalid "field selection on a scalar" error. Paren-balance scan
// because call args can nest (e.g. `vec3(texcoord, depth)`).
function stripShadowSwizzles(source) {
  const marker = 'shadow2D';
  let out = '';
  let i = 0;
  while (i < source.length) {
    const idx = source.indexOf(marker, i);
    if (idx === -1) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, idx) + marker;
    let j = idx + marker.length;
    while (j < source.length && /\s/.test(source[j])) j++;
    if (source[j] !== '(') { i = idx + marker.length; continue; }
    let depth = 0;
    let k = j;
    for (; k < source.length; k++) {
      if (source[k] === '(') depth++;
      else if (source[k] === ')') { depth--; if (depth === 0) { k++; break; } }
    }
    out += source.slice(j, k); // the "(...)" call args, unchanged
    let m = k;
    while (m < source.length && /\s/.test(source[m])) m++;
    if (source[m] === '.' && /[rgbaxyzwRGBAXYZW]/.test(source[m + 1] || '')) {
      let end = m + 1;
      while (end < source.length && /[rgbaxyzwRGBAXYZW]/.test(source[end])) end++;
      i = end; // skip the swizzle entirely
    } else {
      i = k;
    }
  }
  return out;
}

function stripVersionLine(source) {
  return source.replace(VERSION_RE, '').trimStart();
}

function findUsedIdentifiers(source, names) {
  return names.filter((name) => new RegExp(`\\b${name}\\b`).test(source));
}

function buildUniformDecls(source) {
  const used = findUsedIdentifiers(source, KNOWN_UNIFORMS);
  const typeFor = (name) => {
    if (/Matrix|View|Projection$/i.test(name) && !/Inverse|Previous/.test(name) === false) {
      // handled below by explicit map; fallback ignored
    }
    return null;
  };
  const MATRIX4 = new Set([
    'gbufferModelView', 'gbufferModelViewInverse', 'gbufferProjection', 'gbufferProjectionInverse',
    'gbufferPreviousModelView', 'gbufferPreviousProjection',
    'shadowModelView', 'shadowModelViewInverse', 'shadowProjection', 'shadowProjectionInverse',
  ]);
  const MATRIX3 = new Set(['normalMatrix']);
  const VEC3 = new Set([
    'cameraPosition', 'previousCameraPosition', 'sunPosition', 'moonPosition',
    'shadowLightPosition', 'upPosition', 'skyColor', 'fogColor',
  ]);
  const INT = new Set(['frameCounter', 'worldTime', 'worldDay', 'moonPhase', 'isEyeInWater',
    'entityId', 'blockEntityId', 'heldItemId', 'heldItemId2']);
  const BOOL = new Set([]);

  const lines = [];
  for (const name of used) {
    let glType = 'float';
    if (MATRIX4.has(name)) glType = 'mat4';
    else if (MATRIX3.has(name)) glType = 'mat3';
    else if (VEC3.has(name)) glType = 'vec3';
    else if (INT.has(name)) glType = 'int';
    else if (BOOL.has(name)) glType = 'bool';
    lines.push(`uniform ${glType} ${name};`);
  }
  return lines.join('\n');
}

// Remove the pack's own `uniform TYPE name;` declarations for any name we
// inject a canonical declaration for ourselves (Minecraft uniforms,
// colortex/depthtex/shadowtex samplers, and the atlas/lightmap samplers).
// Without this, the pack's original line plus our injected header line
// are both present and the shader fails to compile as a duplicate
// declaration.
function stripKnownUniformDecls(source) {
  const knownNames = [...KNOWN_UNIFORMS, ...SAMPLER_NAMES, ...STANDARD_SAMPLERS];
  let out = source;
  for (const name of knownNames) {
    const re = new RegExp(`^[ \\t]*uniform[ \\t]+\\w+[ \\t]+${name}[ \\t]*(\\[[^\\]]*\\])?[ \\t]*;[ \\t]*(?://.*)?$`, 'gm');
    out = out.replace(re, '');
  }
  return out;
}

function buildSamplerDecls(source, shadowComparisonSamplers = new Set()) {
  const used = findUsedIdentifiers(source, [...SAMPLER_NAMES, ...STANDARD_SAMPLERS]);
  const lines = [];
  for (const name of used) {
    const real = GAUX_ALIAS[name] ?? name;
    const type = shadowComparisonSamplers.has(name) ? 'sampler2DShadow' : 'sampler2D';
    lines.push(`uniform ${type} ${real === name ? name : real};`);
    if (real !== name) lines.push(`#define ${name} ${real}`);
  }
  return lines.join('\n');
}

/**
 * Translate one shader source file (vertex or fragment) from
 * Iris/OptiFine desktop GLSL to WebGL2 GLSL ES.
 *
 * @param {string} filePath
 * @param {string} rawSource
 * @param {{loaderDefines?: string[], versionDefines?: string[]}} opts
 * @returns {{ stage: 'vertex'|'fragment', code: string, warnings: string[] }}
 */
export function translateSource(filePath, rawSource, opts = {}) {
  const stage = detectStage(filePath);
  const warnings = [];
  let body = stripVersionLine(rawSource);

  // --- attribute/varying keyword migration (GLSL ES 300 requires in/out) ---
  if (stage === 'vertex') {
    body = body.replace(/\battribute\b/g, 'in');
    body = body.replace(/\bvarying\b/g, 'out');
  } else {
    body = body.replace(/\bvarying\b/g, 'in');
  }

  // --- legacy fixed-function attributes -> real attributes we feed in ---
  if (stage === 'vertex') {
    const declLines = [];
    for (const [legacyName, info] of Object.entries(LEGACY_ATTRIBUTES)) {
      if (new RegExp(`\\b${legacyName}\\b`).test(body)) {
        declLines.push(`in ${info.attrType} ${info.attribute};`);
        const re = new RegExp(`\\b${legacyName}\\b`, 'g');
        body = body.replace(re, info.promote);
      }
    }
    body = declLines.join('\n') + '\n' + body;
  }

  // --- legacy fixed-function matrices -> our uniforms ---
  for (const [legacy, replacement] of Object.entries(LEGACY_MATRICES)) {
    if (body.includes(legacy)) {
      body = body.replaceAll(legacy, replacement);
    }
  }

  // --- gl_TextureMatrix[n]: rare to be non-identity for block textures, but
  // real packs still reference it. Rewrite to a named uniform per index and
  // declare it (bound to identity by the uniform provider). ---
  let textureMatrixDecls = '';
  const textureMatrixIndices = new Set();
  body = body.replace(/gl_TextureMatrix\[(\d+)\]/g, (m, idx) => {
    textureMatrixIndices.add(idx);
    return `mc_TextureMatrix${idx}`;
  });
  for (const idx of textureMatrixIndices) {
    textureMatrixDecls += `uniform mat4 mc_TextureMatrix${idx};\n`;
  }

  // --- OptiFine packs name the block-atlas sampler uniform `texture`,
  // which collides with GLSL ES 300's built-in `texture()` sampling
  // function once texture2D() gets renamed below. Rename the *variable*
  // first (bare word boundary; doesn't touch texture2D/3D/Cube etc since
  // "texture2D" has no word-boundary between "e" and "2"). ---
  if (/\btexture\b/.test(body)) {
    body = body.replace(/\btexture\b/g, 'mc_Texture');
  }

  // --- which shadow samplers are used as true depth-comparison samplers
  // (accessed via shadow2D, taking a vec3 uv+reference-depth) vs plain
  // color/depth reads (texture2D) - determines the GLSL type we declare
  // them as below. Must be captured before the renames that follow. ---
  const shadowComparisonSamplers = new Set(
    [...body.matchAll(/\bshadow2D\s*\(\s*(shadowtex\d+|shadowcolor\d+)\b/g)].map((m) => m[1])
  );
  if (shadowComparisonSamplers.size > 0) {
    body = stripShadowSwizzles(body);
  }

  // --- texture sampling function renames (desktop GLSL -> GLSL ES 300) ---
  body = body.replace(/\btexture2DLod\b/g, 'textureLod');
  body = body.replace(/\btexture2DProj\b/g, 'textureProj');
  body = body.replace(/\btexture2D\b/g, 'texture');
  body = body.replace(/\bshadow2D\b/g, 'texture');
  body = body.replace(/\btexture3D\b/g, 'texture');
  body = body.replace(/\btextureCube\b/g, 'texture');

  // --- fragment output: gl_FragColor / gl_FragData[n] -> declared out vars ---
  let fragOutDecls = '';
  if (stage === 'fragment') {
    const usesFragColor = /\bgl_FragColor\b/.test(body);
    const fragDataMatches = [...body.matchAll(/\bgl_FragData\[(\d+)\]/g)];
    const usesFragData = fragDataMatches.length > 0;

    if (usesFragColor) {
      fragOutDecls += 'layout(location = 0) out vec4 fragColor0;\n';
      body = body.replace(/\bgl_FragColor\b/g, 'fragColor0');
    }
    if (usesFragData) {
      const indices = [...new Set(fragDataMatches.map((m) => Number(m[1])))].sort((a, b) => a - b);
      for (const idx of indices) {
        fragOutDecls += `layout(location = ${idx}) out vec4 fragColor${idx};\n`;
        body = body.replaceAll(`gl_FragData[${idx}]`, `fragColor${idx}`);
      }
    }
    if (!usesFragColor && !usesFragData) {
      // Pack may already use a custom `out` (rare for OptiFine-era code but
      // valid) - leave as-is.
      warnings.push('No gl_FragColor/gl_FragData write found - assuming custom out variable(s).');
    }
  }

  // --- inject uniform + sampler declarations for anything referenced ---
  // (computed from the source *before* stripping, so we still detect what
  // the pack references; then the pack's own matching decl lines are
  // removed so we don't end up with duplicates)
  const uniformDecls = buildUniformDecls(body);
  const samplerDecls = buildSamplerDecls(body, shadowComparisonSamplers);
  body = stripKnownUniformDecls(body);

  const loaderDefines = (opts.loaderDefines ?? []).map((d) => `#define ${d}`).join('\n');

  const needsShadowPrecision = /\bsampler2DShadow\b/.test(samplerDecls);

  const header = [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    needsShadowPrecision ? 'precision highp sampler2DShadow;' : '',
    loaderDefines,
    uniformDecls,
    textureMatrixDecls,
    samplerDecls,
    fragOutDecls,
  ].filter(Boolean).join('\n');

  return { stage, code: `${header}\n${body}`, warnings };
}
