// heaviness-score.js
//
// Static complexity heuristic -> a 1-100 "how heavy is this shader"
// score, with no actual benchmarking. Real GPU cost depends on the
// user's hardware, resolution, and runtime branch behaviour, which a
// static pass can't know - so this reads the pack's *source* for the
// signals that reliably correlate with cost: how many passes it runs,
// at what resolution, how many texture samples/loops each pass does,
// and whether it enables known-expensive techniques. It's a proxy, not
// a benchmark, and the breakdown is shown alongside the number so the
// score isn't a black box.

const EXPENSIVE_KEYWORDS = [
  { pattern: /\bSSR\b|screen[ _-]?space[ _-]?reflect/i, label: 'Screen-space reflections', weight: 10 },
  { pattern: /\bSSAO\b|ambient[ _-]?occlusion/i, label: 'Ambient occlusion', weight: 6 },
  { pattern: /\bVOLUMETRIC\b|volumetric[ _-]?(light|fog|cloud)/i, label: 'Volumetric lighting/clouds', weight: 12 },
  { pattern: /\bTAA\b|temporal[ _-]?a(a|nti)/i, label: 'Temporal anti-aliasing', weight: 5 },
  { pattern: /\bPOM\b|parallax[ _-]?occlusion/i, label: 'Parallax occlusion mapping', weight: 8 },
  { pattern: /\bPBR\b|physically[ _-]?based/i, label: 'PBR material pipeline', weight: 6 },
  { pattern: /\bBLOOM\b/i, label: 'Bloom', weight: 3 },
  { pattern: /\bMOTION_BLUR\b|motion[ _-]?blur/i, label: 'Motion blur', weight: 4 },
  { pattern: /\bDOF\b|depth[ _-]?of[ _-]?field/i, label: 'Depth of field', weight: 4 },
  { pattern: /\bDENOIS/i, label: 'Denoiser pass', weight: 8 },
  { pattern: /\bVOXEL/i, label: 'Voxelization / GI', weight: 14 },
];

function countMatches(text, re) {
  return (text.match(re) ?? []).length;
}

function analyzeSource(text) {
  const textureSamples = countMatches(text, /\b(texture|texture2D|textureLod|textureProj|texelFetch)\s*\(/g);
  const loops = countMatches(text, /\b(for|while)\s*\(/g);
  const branches = countMatches(text, /\b(if|else if)\s*\(/g);
  const lines = text.split(/\r?\n/).length;
  return { textureSamples, loops, branches, lines };
}

/**
 * @param {Record<string,string>} files - path -> text for the whole pack
 * @param {object} optionsSchema - result of buildOptionsSchema, so enabled
 *   state of e.g. SHADOWS / RESOLUTION options can factor in
 * @returns {{score:number, breakdown: Array<{label:string, points:number}>}}
 */
export function computeHeavinessScore(files, optionsSchema) {
  const shaderFiles = Object.entries(files).filter(([p]) => /\.(fsh|vsh|gsh|csh|glsl)$/i.test(p));
  const composite = shaderFiles.filter(([p]) => /composite\d*\.(fsh|vsh)$/i.test(p));
  const deferred = shaderFiles.filter(([p]) => /deferred\d*\.(fsh|vsh)$/i.test(p));
  const hasShadowPass = shaderFiles.some(([p]) => /shadow(_solid|_cutout)?\.(fsh|vsh)$/i.test(p));

  const breakdown = [];
  let score = 0;

  // 1. Pass count: every composite/deferred pass is a full-screen texture
  // read+write at (usually) full resolution - the single biggest cost
  // driver for a modern shader pack.
  const passCount = composite.length / 2 + deferred.length / 2; // .fsh+.vsh pair per pass
  const passPoints = Math.min(35, Math.round(passCount * 3.5));
  score += passPoints;
  breakdown.push({ label: `${Math.round(passCount)} composite/deferred pass(es)`, points: passPoints });

  // 2. Shadow pass presence + distance/resolution options.
  if (hasShadowPass) {
    let shadowPoints = 10;
    const resOpt = optionsSchema.options.find((o) => /shadowMapResolution/i.test(o.id));
    if (resOpt) {
      const res = parseInt(resOpt.default, 10) || 2048;
      if (res >= 4096) shadowPoints += 8;
      else if (res >= 2048) shadowPoints += 4;
    }
    const distOpt = optionsSchema.options.find((o) => /SHADOW_DISTANCE/i.test(o.id));
    if (distOpt) {
      const dist = parseFloat(distOpt.default) || 32;
      if (dist >= 128) shadowPoints += 6;
      else if (dist >= 64) shadowPoints += 3;
    }
    score += shadowPoints;
    breakdown.push({ label: 'Shadow map pass', points: shadowPoints });
  }

  // 3. Texture sample density + loops/branches across all shader source -
  // rough proxy for per-pixel ALU + bandwidth cost.
  let sampleTotal = 0, loopTotal = 0;
  for (const [, text] of shaderFiles) {
    const a = analyzeSource(text);
    sampleTotal += a.textureSamples;
    loopTotal += a.loops;
  }
  const samplePoints = Math.min(20, Math.round(sampleTotal / 6));
  score += samplePoints;
  breakdown.push({ label: `${sampleTotal} texture samples across all passes`, points: samplePoints });

  const loopPoints = Math.min(10, loopTotal * 2);
  if (loopTotal > 0) {
    score += loopPoints;
    breakdown.push({ label: `${loopTotal} loop construct(s) (often blur/SSR kernels)`, points: loopPoints });
  }

  // 4. Known-expensive technique keywords, scanned across all source +
  // option names/comments (so a technique gated behind a currently-off
  // option still shows up, since flipping it on is one click away).
  const allText = Object.values(files).join('\n') +
    '\n' + optionsSchema.options.map((o) => `${o.id} ${o.comment}`).join('\n');
  const seenLabels = new Set();
  for (const { pattern, label, weight } of EXPENSIVE_KEYWORDS) {
    if (pattern.test(allText) && !seenLabels.has(label)) {
      seenLabels.add(label);
      score += weight;
      breakdown.push({ label, points: weight });
    }
  }

  const clamped = Math.max(1, Math.min(100, Math.round(score)));
  return { score: clamped, breakdown: breakdown.sort((a, b) => b.points - a.points) };
}
