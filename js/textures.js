// textures.js
//
// All textures for the little preview world are generated procedurally
// on an off-screen canvas at runtime - original pixel art, not Mojang's
// assets. Keeps the repo asset-free (no binaries to track) and sidesteps
// any copyright concern entirely.

const TILE = 16; // classic block-texture resolution

function ctxFor(size = TILE) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

// Cheap deterministic pseudo-random noise so textures look hand-speckled
// rather than flat, without needing a seeded RNG library.
function noise(x, y, seed) {
  const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

function speckle(ctx, size, baseColor, variants, seed) {
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise(x, y, seed);
      const variant = variants[Math.floor(n * variants.length)];
      if (variant) {
        ctx.fillStyle = variant;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

function makeTexture(size, draw) {
  const { canvas, ctx } = ctxFor(size);
  draw(ctx, size);
  return canvas;
}

export const TEXTURES = {
  grass_top: () => makeTexture(TILE, (ctx, s) => speckle(ctx, s, '#5b9b4a', ['#5b9b4a', '#5b9b4a', '#66a854', '#4f8a41'], 1)),
  grass_side: () => makeTexture(TILE, (ctx, s) => {
    speckle(ctx, s, '#8a6642', ['#8a6642', '#8a6642', '#7e5c3a', '#93704b'], 2);
    // grass overhang on top third
    ctx.fillStyle = '#5b9b4a';
    ctx.fillRect(0, 0, s, s * 0.3125);
    for (let x = 0; x < s; x++) {
      if (noise(x, 0, 3) > 0.5) ctx.fillRect(x, s * 0.3125, 1, 1);
    }
  }),
  dirt: () => makeTexture(TILE, (ctx, s) => speckle(ctx, s, '#8a6642', ['#8a6642', '#8a6642', '#7e5c3a', '#93704b'], 2)),
  stone: () => makeTexture(TILE, (ctx, s) => speckle(ctx, s, '#8a8a8a', ['#8a8a8a', '#7f7f7f', '#949494', '#767676'], 4)),
  oak_log_side: () => makeTexture(TILE, (ctx, s) => {
    speckle(ctx, s, '#6b5236', ['#6b5236', '#5f4830', '#77593c'], 5);
    for (let x = 0; x < s; x += 3) { ctx.fillStyle = '#5a4429'; ctx.fillRect(x, 0, 1, s); }
  }),
  oak_planks: () => makeTexture(TILE, (ctx, s) => {
    speckle(ctx, s, '#b0834c', ['#b0834c', '#a5793f', '#bb8d59'], 6);
    for (let y = 3; y < s; y += 4) { ctx.fillStyle = '#8a6337'; ctx.fillRect(0, y, s, 1); }
  }),
  stone_bricks: () => makeTexture(TILE, (ctx, s) => {
    speckle(ctx, s, '#8f8f8f', ['#8f8f8f', '#848484', '#999999'], 7);
    ctx.fillStyle = '#6f6f6f';
    for (let y = 0; y < s; y += 4) ctx.fillRect(0, y, s, 1);
    for (let x = 0; x < s; x += 8) ctx.fillRect(x, 0, 1, s);
  }),
  terracotta_pot: () => makeTexture(TILE, (ctx, s) => speckle(ctx, s, '#a2532f', ['#a2532f', '#8f4726', '#b06038'], 8)),
  poppy: () => makeTexture(TILE, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = '#3a7a2e';
    ctx.fillRect(s / 2 - 1, s / 2, 2, s / 2);
    ctx.fillStyle = '#d3311e';
    ctx.fillRect(s / 2 - 4, s / 2 - 6, 8, 6);
    ctx.fillStyle = '#f0b429';
    ctx.fillRect(s / 2 - 1, s / 2 - 4, 2, 2);
  }),
  dandelion: () => makeTexture(TILE, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = '#3a7a2e';
    ctx.fillRect(s / 2 - 1, s / 2, 2, s / 2);
    ctx.fillStyle = '#f2d33c';
    ctx.fillRect(s / 2 - 3, s / 2 - 5, 6, 5);
  }),
};

/** Build a THREE.CanvasTexture from a generated canvas, with nearest-neighbour filtering. */
export function makePixelTexture(THREE, canvasFactory) {
  const canvas = canvasFactory();
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Build a single square block-atlas texture (grid of tiles) so a real
 * translated shader can sample it exactly like Minecraft's terrain atlas -
 * one `mc_Texture` sampler for the whole world, addressed with per-face UVs.
 * Returns { texture, uv(name) } where uv() gives the [u0,v0,u1,v1] rect for
 * a tile name.
 */
export function buildAtlas(THREE) {
  const names = Object.keys(TEXTURES);
  const cols = Math.ceil(Math.sqrt(names.length));
  const rows = Math.ceil(names.length / cols);
  const atlasSize = cols * TILE;

  const canvas = document.createElement('canvas');
  canvas.width = atlasSize;
  canvas.height = rows * TILE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const rects = {};
  names.forEach((name, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const tile = TEXTURES[name]();
    ctx.drawImage(tile, col * TILE, row * TILE);
    rects[name] = [
      (col * TILE) / atlasSize, 1 - ((row + 1) * TILE) / (rows * TILE),
      ((col + 1) * TILE) / atlasSize, 1 - (row * TILE) / (rows * TILE),
    ];
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  return { texture, uv: (name) => rects[name] ?? rects.stone };
}
