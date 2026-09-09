// shader-options-parser.js
//
// Real shader packs expose their user-facing settings two ways, and both
// are needed to build an accurate settings panel:
//
//   1. Inline in the GLSL source, e.g.:
//        #define SHADOWS            // Enable shadows [false true]
//        #define SHADOW_DISTANCE 32.0 // Shadow render distance [16.0 32.0 64.0 128.0]
//        const int shadowMapResolution = 2048; //[512 1024 2048 4096]
//      A bare `#define NAME` with no value and a [false true] choice list
//      is a boolean toggle; a commented-out `//#define NAME` starts OFF.
//
//   2. shaders.properties, which mostly organizes those options into GUI
//      screens/sliders/profiles rather than declaring new ones:
//        screen = SHADOWS RESOLUTION [SHADOW]
//        screen.SHADOW = SHADOW_DISTANCE SHADOW_QUALITY
//        sliderOptions = SHADOW_DISTANCE
//
// This module scans every source file for pattern (1), then layers in
// screen/grouping metadata from shaders.properties if present.

const DEFINE_RE =
  /^[ \t]*(\/\/[ \t]*)?#define[ \t]+([A-Za-z_][A-Za-z0-9_]*)(?:[ \t]+([^\n/]*?))?[ \t]*(?:\/\/[ \t]*(.*))?$/;
const CONST_RE =
  /^[ \t]*const[ \t]+(int|float|bool)[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*([^;]+);[ \t]*(?:\/\/[ \t]*(.*))?$/;
// A trailing comment like "Enable shadows [false true]" or "[16.0 32.0 64.0]"
const CHOICES_RE = /\[([^\]]*)\]/;

function parseChoicesFromComment(comment) {
  if (!comment) return null;
  const m = comment.match(CHOICES_RE);
  if (!m) return null;
  return m[1].trim().split(/\s+/).filter(Boolean);
}

function stripChoices(comment) {
  if (!comment) return '';
  return comment.replace(CHOICES_RE, '').trim();
}

/**
 * Scan one GLSL source file's text for #define / const option declarations.
 * @param {string} filePath
 * @param {string} text
 * @returns {Array<object>} option descriptors
 */
export function parseInlineOptions(filePath, text) {
  const options = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const defineMatch = line.match(DEFINE_RE);
    if (defineMatch) {
      const [, commentedOut, name, rawValue, trailingComment] = defineMatch;
      const choices = parseChoicesFromComment(trailingComment);
      // Only treat this as a user-facing *option* if it has a choice list
      // (that's the OptiFine/Iris convention for "this is exposed in the
      // GUI"). Plain internal #defines without [choices] are left alone -
      // they're implementation details, not settings.
      if (!choices) continue;

      const hasValue = rawValue !== undefined && rawValue.trim().length > 0;
      const isBoolLike = !hasValue || choices.every((c) => c === 'true' || c === 'false');

      options.push({
        id: name,
        kind: isBoolLike ? 'bool' : (choices.length > 1 ? 'dropdown' : 'value'),
        default: isBoolLike ? String(!commentedOut) : (rawValue ? rawValue.trim() : choices[0]),
        enabled: !commentedOut,
        choices: isBoolLike ? ['false', 'true'] : choices,
        comment: stripChoices(trailingComment),
        source: 'define',
        file: filePath,
        line: i + 1,
      });
      continue;
    }

    const constMatch = line.match(CONST_RE);
    if (constMatch) {
      const [, type, name, rawValue, trailingComment] = constMatch;
      const choices = parseChoicesFromComment(trailingComment);
      if (!choices) continue; // not exposed as an option
      options.push({
        id: name,
        kind: type === 'bool' ? 'bool' : 'dropdown',
        default: rawValue.trim(),
        enabled: true,
        choices,
        comment: stripChoices(trailingComment),
        source: 'const',
        // const options require a shader *recompile* (not just a uniform
        // update) since they change the GLSL text itself - flagged so the
        // pipeline knows to re-translate/recompile on change.
        requiresRecompile: true,
        file: filePath,
        line: i + 1,
      });
    }
  }

  return options;
}

/**
 * Very small shaders.properties reader - pulls out screen groupings and
 * slider ordering so the settings panel can present options the way the
 * pack author intended, rather than as one flat list. Full properties
 * spec (profiles, custom uniforms, program overrides) is large; this
 * covers the layout-relevant subset.
 */
export function parseShadersProperties(text) {
  const screens = {}; // screenName -> [optionId, ...] ; '' = top-level
  const sliderOrder = [];
  const profiles = {};

  if (!text) return { screens, sliderOrder, profiles };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    if (key === 'screen') {
      screens[''] = value.replace(/\[|\]/g, '').split(/\s+/).filter(Boolean);
    } else if (key.startsWith('screen.')) {
      const screenName = key.slice('screen.'.length);
      screens[screenName] = value.split(/\s+/).filter(Boolean);
    } else if (key === 'sliderOptions') {
      sliderOrder.push(...value.split(/\s+/).filter(Boolean));
    } else if (key.startsWith('profile.')) {
      const profileName = key.slice('profile.'.length);
      profiles[profileName] = value.split(/\s+/).filter(Boolean);
    }
  }

  return { screens, sliderOrder, profiles };
}

/**
 * Merge inline options found across every shader source file with
 * shaders.properties grouping data into one schema, deduped by id
 * (first definition wins - matches how the real loaders behave when the
 * same #define appears in a shared/included file).
 *
 * @param {Record<string,string>} files - path -> file text, for the whole pack
 * @returns {{options: object[], screens: object, sliderOrder: string[]}}
 */
export function buildOptionsSchema(files) {
  const seen = new Map();

  for (const [path, text] of Object.entries(files)) {
    if (!/\.(fsh|vsh|gsh|csh|glsl)$/i.test(path)) continue;
    for (const opt of parseInlineOptions(path, text)) {
      if (!seen.has(opt.id)) seen.set(opt.id, opt);
    }
  }

  const propsText = files['shaders/shaders.properties'] ?? files['shaders.properties'];
  const { screens, sliderOrder, profiles } = parseShadersProperties(propsText);

  return {
    options: Array.from(seen.values()),
    screens,
    sliderOrder,
    profiles,
  };
}
