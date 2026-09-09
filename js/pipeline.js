// pipeline.js
//
// Orchestrates the actual render: one gbuffer pass (world geometry, real
// translated gbuffers_* program if present) into a multi-target buffer,
// then the pack's composite/composite1..N passes in order as full-screen
// quads, then `final` (or a plain blit if the pack has no final.fsh).
//
// Scope note (matches the "core passes first" decision): the shadow pass
// and per-block-type gbuffers programs beyond terrain/water are not wired
// up yet - shadowtex/shadowcolor samplers are declared (so packs compile)
// but currently bound to a blank white texture, which reads as "always
// lit" rather than a real shadow map. That's the next phase of work.

import { translateSource, applyOptionOverrides } from './glsl-translator.js';
import { GBUFFER_FALLBACKS, MAX_COMPOSITE_PASSES, COLOR_TEX_COUNT } from './constants.js';

const RENDERTARGETS_RE = /\/\*\s*RENDERTARGETS:\s*([\d,\s]+)\*\//;

function parseRenderTargets(rawSource) {
  const m = rawSource.match(RENDERTARGETS_RE);
  if (!m) return [0];
  return m[1].split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
}

/** Compile a THREE.RawShaderMaterial-compatible {vertexShader, fragmentShader} pair, or null + log on failure. */
function tryTranslateProgram(files, baseName, options, overrides, loaderDefines, log) {
  const vshPath = `shaders/${baseName}.vsh`;
  const fshPath = `shaders/${baseName}.fsh`;
  if (!files[vshPath] || !files[fshPath]) return null;

  try {
    const vRaw = applyOptionOverrides(files[vshPath], options, overrides);
    const fRaw = applyOptionOverrides(files[fshPath], options, overrides);
    const v = translateSource(vshPath, vRaw, { loaderDefines });
    const f = translateSource(fshPath, fRaw, { loaderDefines });
    const renderTargets = parseRenderTargets(files[fshPath]);
    return { name: baseName, vertexShader: v.code, fragmentShader: f.code, renderTargets, warnings: [...v.warnings, ...f.warnings] };
  } catch (err) {
    log(`error`, `Failed to translate ${baseName}: ${err.message}`);
    return null;
  }
}

function findFirstAvailable(files, candidates) {
  return candidates.find((name) => files[`shaders/${name}.vsh`] && files[`shaders/${name}.fsh`]);
}

export class ShaderPipeline {
  /**
   * @param {object} deps - { THREE, renderer, scene, camera, world, sky, uniformProvider, log }
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.compositePrograms = []; // ordered list of {name, material, renderTargets}
    this.gbufferMaterial = null;
    this.finalProgram = null;
    this.colorTargets = null;
    this.pingPong = null;
    this.loaded = false;
    this._setupTargets();
  }

  _setupTargets() {
    const { THREE, renderer } = this;
    const size = renderer.getSize(new THREE.Vector2());
    const w = Math.max(1, size.x), h = Math.max(1, size.y);

    // Multi-target gbuffer output (colortex0..N) + a depth texture.
    this.gbufferTarget = new THREE.WebGLRenderTarget(w, h, {
      count: COLOR_TEX_COUNT,
      depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType),
      type: THREE.HalfFloatType,
    });

    // Two ping-pong single-target buffers used to chain composite passes -
    // each pass reads the previous colortex0..7 state and writes a new one.
    this.pingPongA = new THREE.WebGLRenderTarget(w, h, { count: COLOR_TEX_COUNT, type: THREE.HalfFloatType });
    this.pingPongB = new THREE.WebGLRenderTarget(w, h, { count: COLOR_TEX_COUNT, type: THREE.HalfFloatType });

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeometry = new THREE.PlaneGeometry(2, 2);
  }

  resize(w, h) {
    this.gbufferTarget.setSize(w, h);
    this.pingPongA.setSize(w, h);
    this.pingPongB.setSize(w, h);
  }

  /**
   * (Re)build every program from a parsed shaderpack + current option
   * overrides. Called on upload and whenever a `requiresRecompile`
   * setting changes.
   */
  load({ files, options, overrides, loaderDefines }) {
    const { log, THREE } = this;
    this.loaded = false;
    this.compositePrograms = [];

    const terrainProgramName = findFirstAvailable(files, GBUFFER_FALLBACKS.terrain);
    if (terrainProgramName) {
      const prog = tryTranslateProgram(files, terrainProgramName, options, overrides, loaderDefines, log);
      if (prog) {
        this.gbufferMaterial = this._makeRawMaterial(prog, { glslVersion: THREE.GLSL3 });
        log('info', `Using ${terrainProgramName} for terrain (${prog.warnings.length} warning(s)).`);
      } else {
        this.gbufferMaterial = null;
        log('warn', `${terrainProgramName} failed to compile - falling back to default lit shading for terrain.`);
      }
    } else {
      this.gbufferMaterial = null;
      log('info', 'No gbuffers_terrain-compatible program in this pack - using default lit shading.');
    }

    for (let i = 0; i < MAX_COMPOSITE_PASSES; i++) {
      const name = i === 0 ? 'composite' : `composite${i}`;
      if (!files[`shaders/${name}.fsh`]) continue;
      const prog = tryTranslateProgram(files, name, options, overrides, loaderDefines, log);
      if (prog) {
        prog.material = this._makeRawMaterial(prog, { glslVersion: THREE.GLSL3, fullscreen: true });
        this.compositePrograms.push(prog);
      } else {
        log('warn', `${name} failed to compile and was skipped.`);
      }
    }

    if (files['shaders/final.fsh']) {
      const prog = tryTranslateProgram(files, 'final', options, overrides, loaderDefines, log);
      if (prog) {
        prog.material = this._makeRawMaterial(prog, { glslVersion: THREE.GLSL3, fullscreen: true });
        this.finalProgram = prog;
      }
    } else {
      this.finalProgram = null;
    }

    this.loaded = true;
    log('info', `Pipeline ready: ${this.compositePrograms.length} composite pass(es)` +
      (this.finalProgram ? ' + final.' : ', no final pass (last composite output is shown directly).'));
  }

  unload() {
    this.gbufferMaterial = null;
    this.compositePrograms = [];
    this.finalProgram = null;
    this.loaded = false;
    this.log('info', 'Shader unloaded - back to default preview shading.');
  }

  _makeRawMaterial({ vertexShader, fragmentShader }, { fullscreen = false } = {}) {
    const { THREE } = this;
    return new THREE.RawShaderMaterial({
      vertexShader: fullscreen ? this._fullscreenVertexShader() : vertexShader,
      fragmentShader,
      glslVersion: THREE.GLSL3,
      uniforms: {}, // populated per-frame in render() via setUniforms
      depthTest: !fullscreen,
      depthWrite: !fullscreen,
    });
  }

  _fullscreenVertexShader() {
    // Composite/final passes are always a plain full-screen triangle in a
    // real loader too - the pack's own composite.vsh is typically a no-op
    // passthrough, so we supply a fixed one rather than re-translating it.
    return `#version 300 es
      in vec3 position;
      in vec2 uv;
      out vec2 texcoord;
      void main() {
        texcoord = uv;
        gl_Position = vec4(position, 1.0);
      }`;
  }

  /** Bind every known uniform value onto a material, skipping ones it doesn't declare (Three.js just ignores unused entries). */
  _applyUniforms(material, uniformMap, extraSamplers = {}) {
    const { THREE } = this;
    for (const [name, value] of Object.entries(uniformMap)) {
      if (Array.isArray(value)) {
        material.uniforms[name] = { value: value.length === 3 ? new THREE.Vector3(...value) : value };
      } else {
        material.uniforms[name] = { value };
      }
    }
    for (const [name, tex] of Object.entries(extraSamplers)) {
      material.uniforms[name] = { value: tex };
    }
    material.uniformsNeedUpdate = true;
  }

  /** Render one frame. `worldMeshes` is [terrainMesh, propMesh, skyMesh]. */
  render({ worldMeshes, uniformMap, atlasTexture, lightmapTexture }) {
    const { THREE, renderer, scene, camera } = this;

    if (!this.gbufferMaterial) {
      // Fallback path: default materials, straight to screen.
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }

    // 1. gbuffer pass -> MRT target
    const prevMaterials = worldMeshes.map((m) => m.material);
    worldMeshes.forEach((m) => {
      if (m.userData.isSky) return; // sky kept on its own simple material for now (see file header note)
      this._applyUniforms(this.gbufferMaterial, uniformMap, { mc_Texture: atlasTexture, lightmap: lightmapTexture });
      m.material = this.gbufferMaterial;
    });
    renderer.setRenderTarget(this.gbufferTarget);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    worldMeshes.forEach((m, i) => { m.material = prevMaterials[i]; });

    // 2. composite chain, ping-ponging between two MRT buffers
    let readTarget = this.gbufferTarget;
    let writeTarget = this.pingPongA;
    const quadMesh = new THREE.Mesh(this.quadGeometry);

    for (const prog of this.compositePrograms) {
      quadMesh.material = prog.material;
      this._applyUniforms(prog.material, uniformMap, this._colortexSamplers(readTarget));
      renderer.setRenderTarget(writeTarget);
      renderer.render(quadMesh, this.quadCamera);
      [readTarget, writeTarget] = [writeTarget, writeTarget === this.pingPongA ? this.pingPongB : this.pingPongA];
    }

    // 3. final pass (or plain blit of the last composite output)
    quadMesh.material = this.finalProgram
      ? this.finalProgram.material
      : this._passthroughMaterial();
    this._applyUniforms(quadMesh.material, uniformMap, this._colortexSamplers(readTarget));
    renderer.setRenderTarget(null);
    renderer.render(quadMesh, this.quadCamera);
  }

  _colortexSamplers(target) {
    const samplers = {};
    for (let i = 0; i < COLOR_TEX_COUNT; i++) {
      samplers[`colortex${i}`] = target.textures ? target.textures[i] : (i === 0 ? target.texture : null);
    }
    samplers.depthtex0 = target.depthTexture ?? null;
    return samplers;
  }

  _passthroughMaterial() {
    if (!this._passthrough) {
      const { THREE } = this;
      this._passthrough = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: this._fullscreenVertexShader(),
        fragmentShader: `#version 300 es
          precision highp float;
          uniform sampler2D colortex0;
          in vec2 texcoord;
          out vec4 fragColor;
          void main() { fragColor = texture(colortex0, texcoord); }`,
        uniforms: {},
      });
    }
    return this._passthrough;
  }
}
