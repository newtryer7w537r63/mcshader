// world.js
//
// Builds the little preview scene geometry: a blocky hill topped with
// grass, a couple of flowers, flower pots, a short staircase, and a
// gradient skybox with a sun/moon that moves on a day cycle. Geometry
// carries BOTH the standard Three.js attribute names (position/normal/
// uv/color - needed for Three.js internals like bounding-sphere/raycasting)
// AND aliased `va*` names (vaPosition/vaNormal/vaUV0/vaUV1/vaColor) that
// a translated Iris/OptiFine shader's `in` attributes bind to - see
// glsl-translator.js's LEGACY_ATTRIBUTES table for the naming contract.

import { buildAtlas } from './textures.js';

const BLOCK = 1; // world units per block

class GeometryBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uv0 = [];
    this.uv1 = [];
    this.colors = [];
    this.indices = [];
  }

  // Adds one quad face. `light` is a 0-1 block-light proxy baked as the
  // vaUV1/lightmap coordinate (mimics Minecraft's per-vertex lightmap UV).
  addFace(verts, normal, uvRect, tint = [1, 1, 1], light = 1) {
    const base = this.positions.length / 3;
    const [u0, v0, u1, v1] = uvRect;
    const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (let i = 0; i < 4; i++) {
      this.positions.push(...verts[i]);
      this.normals.push(...normal);
      this.uv0.push(...uvs[i]);
      this.uv1.push(light, 1.0); // (block light, sky light) proxy
      this.colors.push(...tint);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  addBox(x, y, z, w, h, d, faceUVs, opts = {}) {
    const { skipFaces = [], tint = [1, 1, 1], light = 1 } = opts;
    const x0 = x, x1 = x + w, y0 = y, y1 = y + h, z0 = z, z1 = z + d;
    const faces = {
      top: { verts: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], normal: [0, 1, 0] },
      bottom: { verts: [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], normal: [0, -1, 0] },
      north: { verts: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], normal: [0, 0, -1] },
      south: { verts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], normal: [0, 0, 1] },
      west: { verts: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], normal: [-1, 0, 0] },
      east: { verts: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], normal: [1, 0, 0] },
    };
    for (const [name, face] of Object.entries(faces)) {
      if (skipFaces.includes(name)) continue;
      const uv = faceUVs[name] ?? faceUVs.all;
      this.addFace(face.verts, face.normal, uv, tint, light);
    }
  }

  addCrossQuad(x, y, z, size, uvRect, tint = [1, 1, 1]) {
    // Two intersecting vertical quads - the classic Minecraft flora shape.
    const h = size, half = size / 2;
    const cx = x + BLOCK / 2, cz = z + BLOCK / 2;
    const quads = [
      [[cx - half, y, cz - half], [cx + half, y, cz + half]],
      [[cx - half, y, cz + half], [cx + half, y, cz - half]],
    ];
    for (const [a, b] of quads) {
      const verts = [
        [a[0], y, a[2]], [b[0], y, b[2]], [b[0], y + h, b[2]], [a[0], y + h, a[2]],
      ];
      this.addFace(verts, [0, 0, 1], uvRect, tint, 1);
      this.addFace([...verts].reverse(), [0, 0, -1], uvRect, tint, 1);
    }
  }

  toBufferGeometry(THREE) {
    const geo = new THREE.BufferGeometry();
    const position = new THREE.Float32BufferAttribute(this.positions, 3);
    const normal = new THREE.Float32BufferAttribute(this.normals, 3);
    const uv = new THREE.Float32BufferAttribute(this.uv0, 2);
    const uv1 = new THREE.Float32BufferAttribute(this.uv1, 2);
    const color = new THREE.Float32BufferAttribute(this.colors, 3);

    geo.setAttribute('position', position);
    geo.setAttribute('normal', normal);
    geo.setAttribute('uv', uv);
    geo.setAttribute('uv2', uv1);
    geo.setAttribute('color', color);
    // Aliases a translated shader's legacy attributes bind to.
    geo.setAttribute('vaPosition', position);
    geo.setAttribute('vaNormal', normal);
    geo.setAttribute('vaUV0', uv);
    geo.setAttribute('vaUV1', uv1);
    geo.setAttribute('vaColor', color);
    geo.setIndex(this.indices);
    geo.computeBoundingSphere();
    return geo;
  }
}

// Radial-falloff hill, stepped to whole blocks for a blocky look.
function hillHeight(gx, gz, size, peak) {
  const cx = size / 2, cz = size / 2;
  const dist = Math.hypot(gx - cx, gz - cz) / (size / 2);
  const h = Math.max(0, peak * (1 - dist * dist));
  return Math.max(1, Math.round(h));
}

function buildStairs(builder, atlasUV, x, y, z, facing = 'south') {
  const stone = atlasUV('stone_bricks');
  // bottom slab: full footprint, half height
  builder.addBox(x, y, z, BLOCK, BLOCK / 2, BLOCK, { all: stone });
  // upper step: half-depth block sitting on the back half, matching `facing`
  const backHalf = facing === 'south' ? [x, y + BLOCK / 2, z] : [x, y + BLOCK / 2, z + BLOCK / 2];
  builder.addBox(backHalf[0], backHalf[1], backHalf[2], BLOCK, BLOCK / 2, BLOCK / 2, { all: stone });
}

/**
 * Build the whole preview scene as a set of Three.js objects, returned so
 * the caller (renderer) can add them to a scene and swap materials when a
 * real shader's gbuffers programs become available.
 */
export function buildWorld(THREE) {
  const { texture: atlasTexture, uv: atlasUV } = buildAtlas(THREE);

  const builder = new GeometryBuilder();
  const size = 10;
  const peak = 4;
  const heights = [];

  for (let gx = 0; gx < size; gx++) {
    heights[gx] = [];
    for (let gz = 0; gz < size; gz++) {
      heights[gx][gz] = hillHeight(gx, gz, size, peak);
    }
  }

  const grassUVs = { top: atlasUV('grass_top'), bottom: atlasUV('dirt'), all: atlasUV('grass_side') };
  const dirtUVs = { all: atlasUV('dirt') };

  for (let gx = 0; gx < size; gx++) {
    for (let gz = 0; gz < size; gz++) {
      const h = heights[gx][gz];
      const x = gx * BLOCK, z = gz * BLOCK;
      for (let y = 0; y < h; y++) {
        const isTop = y === h - 1;
        const skipFaces = [];
        // cheap face culling against the four neighbours at this layer
        const neighH = (dx, dz) => (heights[gx + dx]?.[gz + dz] ?? 0);
        if (neighH(0, -1) > y + 1) skipFaces.push('north');
        if (neighH(0, 1) > y + 1) skipFaces.push('south');
        if (neighH(-1, 0) > y + 1) skipFaces.push('west');
        if (neighH(1, 0) > y + 1) skipFaces.push('east');
        if (y > 0) skipFaces.push('bottom');
        if (!isTop) skipFaces.push('top');
        builder.addBox(x, y, z, BLOCK, BLOCK, BLOCK, isTop ? grassUVs : dirtUVs, { skipFaces });
      }
    }
  }

  // Flowers scattered near the peak.
  const poppyUV = atlasUV('poppy');
  const dandelionUV = atlasUV('dandelion');
  const flowerSpots = [[4, 3], [6, 4], [3, 6], [5, 6]];
  flowerSpots.forEach(([gx, gz], i) => {
    const h = heights[gx]?.[gz] ?? peak;
    builder.addCrossQuad(gx * BLOCK, h * BLOCK, gz * BLOCK, 1.0, i % 2 === 0 ? poppyUV : dandelionUV);
  });

  // A short staircase leading up one side of the hill.
  const stairBase = heights[1]?.[5] ?? 1;
  for (let i = 0; i < 3; i++) {
    buildStairs(builder, atlasUV, 1 * BLOCK, (stairBase + i) * BLOCK, (4 + i) * BLOCK, 'south');
  }

  const geometry = builder.toBufferGeometry(THREE);

  // Flower pots: small terracotta pot + mini flower, placed as separate
  // small meshes (their own tiny geometry) so they read as distinct props.
  const potBuilder = new GeometryBuilder();
  const potUV = atlasUV('terracotta_pot');
  const potSpots = [[7, 7], [2, 2]];
  potSpots.forEach(([gx, gz]) => {
    const h = heights[gx]?.[gz] ?? peak;
    const px = gx * BLOCK + 0.3, pz = gz * BLOCK + 0.3, py = h * BLOCK;
    potBuilder.addBox(px, py, pz, 0.4, 0.3, 0.4, { all: potUV });
    potBuilder.addCrossQuad(px - 0.3, py + 0.3, pz - 0.3, 0.5, dandelionUV);
  });
  const potGeometry = potBuilder.toBufferGeometry(THREE);

  return {
    terrainGeometry: geometry,
    propGeometry: potGeometry,
    atlasTexture,
    heights,
    size,
    peak,
  };
}

/** Gradient skybox + a sun/moon disc that rotates on a day-length timer. */
export function buildSky(THREE) {
  const skyGeo = new THREE.SphereGeometry(80, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color('#4a90d9') },
      bottomColor: { value: new THREE.Color('#cfe8ff') },
      sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 sunDirection;
      varying vec3 vWorldPos;
      void main() {
        float h = normalize(vWorldPos).y * 0.5 + 0.5;
        vec3 sky = mix(bottomColor, topColor, clamp(h, 0.0, 1.0));
        float sunDot = max(dot(normalize(vWorldPos), normalize(sunDirection)), 0.0);
        vec3 sunGlow = vec3(1.0, 0.95, 0.8) * pow(sunDot, 128.0) * 2.0;
        gl_FragColor = vec4(sky + sunGlow, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);

  const sunGeo = new THREE.PlaneGeometry(6, 6);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0, side: THREE.DoubleSide, fog: false });
  const sunMesh = new THREE.Mesh(sunGeo, sunMat);

  const moonMat = new THREE.MeshBasicMaterial({ color: 0xc9d6e8, side: THREE.DoubleSide, fog: false });
  const moonMesh = new THREE.Mesh(sunGeo.clone(), moonMat);

  return { skyMesh, sunMesh, moonMesh, skyMat };
}
