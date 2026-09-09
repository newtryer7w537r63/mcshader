// zip-reader.js
//
// Shaderpacks are distributed as a .zip (sometimes with everything under
// a `shaders/` folder, sometimes with an extra top-level wrapper folder
// from how the zip was created). This normalizes both layouts into a
// flat map keyed by the path relative to the pack root, e.g.
// "shaders/composite.fsh", "shaders/shaders.properties".

import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';

const TEXT_EXTENSIONS = /\.(properties|fsh|vsh|gsh|csh|glsl|txt|md|json)$/i;

/**
 * @param {File|Blob} file
 * @returns {Promise<{files: Record<string,string>, binaryPaths: string[], root: string}>}
 */
export async function readShaderpackZip(file) {
  const zip = await JSZip.loadAsync(file);
  const allPaths = Object.keys(zip.files).filter((p) => !zip.files[p].dir);

  // Detect a single top-level wrapper folder (e.g. "MyShader-v3/shaders/...")
  // and strip it so paths are always rooted at the pack itself.
  const topLevelDirs = new Set(
    allPaths
      .map((p) => p.split('/')[0])
      .filter((seg, i, arr) => allPaths.every((p) => p.startsWith(seg + '/')))
  );
  const stripPrefix = topLevelDirs.size === 1 ? [...topLevelDirs][0] + '/' : '';

  const files = {};
  const binaryPaths = [];

  await Promise.all(allPaths.map(async (path) => {
    const relPath = stripPrefix && path.startsWith(stripPrefix) ? path.slice(stripPrefix.length) : path;
    if (!relPath) return;
    if (TEXT_EXTENSIONS.test(relPath)) {
      files[relPath] = await zip.files[path].async('string');
    } else {
      binaryPaths.push(relPath);
    }
  }));

  if (!Object.keys(files).some((p) => p.startsWith('shaders/'))) {
    throw new Error(
      'No shaders/ folder found in this zip. Make sure you\'re uploading the shaderpack ' +
      'itself (the zip that goes straight into .minecraft/shaderpacks), not a folder containing it.'
    );
  }

  return { files, binaryPaths, root: stripPrefix };
}

/** List the program names present (e.g. "composite1", "gbuffers_terrain") grouped by base program. */
export function listPrograms(files) {
  const programs = new Set();
  for (const path of Object.keys(files)) {
    const m = path.match(/^shaders\/([A-Za-z_]+\d*)\.(fsh|vsh|gsh|csh)$/);
    if (m) programs.add(m[1]);
  }
  return [...programs].sort();
}
