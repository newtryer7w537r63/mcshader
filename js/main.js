// main.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { SHADER_LOADERS } from './constants.js';
import { readShaderpackZip, listPrograms } from './zip-reader.js';
import { buildOptionsSchema } from './shader-options-parser.js';
import { computeHeavinessScore } from './heaviness-score.js';
import { buildWorld, buildSky } from './world.js';
import { UniformProvider } from './uniform-provider.js';
import { ShaderPipeline } from './pipeline.js';
import { SettingsPanel } from './settings-panel.js';
import { ConsoleLog } from './console-log.js';

const $ = (id) => document.getElementById(id);

const consoleLog = new ConsoleLog($('console-log'));
const log = (level, msg) => consoleLog.log(level, msg);

// --- renderer / scene / camera -----------------------------------------
const canvas = $('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
camera.position.set(14, 9, 14);

const controls = new OrbitControls(camera, canvas);
controls.target.set(5, 3, 5);
controls.enableDamping = true;

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas.parentElement;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  pipeline?.resize(w, h);
}

// --- world -----------------------------------------------------------
const { terrainGeometry, propGeometry, atlasTexture } = buildWorld(THREE);
const defaultMaterial = new THREE.MeshLambertMaterial({ map: atlasTexture, vertexColors: false });
const terrainMesh = new THREE.Mesh(terrainGeometry, defaultMaterial);
const propMesh = new THREE.Mesh(propGeometry, defaultMaterial);
scene.add(terrainMesh, propMesh);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0x8899aa, 0.5));

const { skyMesh, sunMesh, moonMesh, skyMat } = buildSky(THREE);
skyMesh.userData.isSky = true;
scene.add(skyMesh, sunMesh, moonMesh);

// A 16x16 flat-white lightmap placeholder - Minecraft's real lightmap
// (block+sky light -> colour ramp) is per-pack-tinted in composite passes,
// so we hand translated shaders a neutral "fully lit" ramp for now.
const lightmapCanvas = document.createElement('canvas');
lightmapCanvas.width = lightmapCanvas.height = 16;
lightmapCanvas.getContext('2d').fillStyle = '#fff';
lightmapCanvas.getContext('2d').fillRect(0, 0, 16, 16);
const lightmapTexture = new THREE.CanvasTexture(lightmapCanvas);

// --- pipeline ----------------------------------------------------------
const uniformProvider = new UniformProvider({ canvas });
let pipeline = new ShaderPipeline({ THREE, renderer, scene, camera, log });

let currentFiles = null;
let currentSchema = null;
let currentOverrides = {};

const settingsPanel = new SettingsPanel($('settings-panel'), {
  onChange: ({ id, value, requiresRecompile }) => {
    currentOverrides[id] = value;
    if (requiresRecompile && currentFiles) {
      recompile();
    }
    updateHeaviness();
  },
});

function loaderDefinesFor() {
  const loader = SHADER_LOADERS[$('loader-select').value];
  return loader.extraDefines;
}

function recompile() {
  if (!currentFiles) return;
  pipeline.load({
    files: currentFiles,
    options: currentSchema.options,
    overrides: currentOverrides,
    loaderDefines: loaderDefinesFor(),
  });
}

function updateHeaviness() {
  if (!currentFiles) return;
  const { score, breakdown } = computeHeavinessScore(currentFiles, currentSchema);
  $('heaviness-score').textContent = score;
  $('heaviness-fill').style.width = `${score}%`;
  $('heaviness-breakdown').innerHTML = breakdown
    .map((b) => `<li><span>${b.label}</span><span class="points">+${b.points}</span></li>`)
    .join('');
}

async function loadPack(file) {
  try {
    log('info', `Reading ${file.name}...`);
    const { files } = await readShaderpackZip(file);
    currentFiles = files;
    currentSchema = buildOptionsSchema(files);
    currentOverrides = {};

    const programs = listPrograms(files);
    log('info', `Found programs: ${programs.join(', ') || '(none recognised)'}`);

    $('pack-name').textContent = file.name;
    settingsPanel.render(currentSchema);
    recompile();
    updateHeaviness();
  } catch (err) {
    log('error', err.message);
  }
}

// --- upload wiring -------------------------------------------------------
$('file-input').addEventListener('change', (e) => {
  if (e.target.files[0]) loadPack(e.target.files[0]);
});

const dropzone = $('dropzone');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  dropzone.classList.add('active');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropzone.classList.remove('active');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove('active');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.zip')) loadPack(file);
  else if (file) log('error', 'Please drop a .zip shaderpack file.');
});

$('version-select').addEventListener('change', () => {
  log('info', `Preview target set to Minecraft ${$('version-select').value}.`);
  if (currentFiles) recompile();
});
$('loader-select').addEventListener('change', () => {
  const loader = SHADER_LOADERS[$('loader-select').value];
  log('info', `Loader set to ${loader.label} (${loader.modLoader}).`);
  if (currentFiles) recompile();
});

$('console-toggle').addEventListener('click', () => {
  $('console-drawer').classList.toggle('collapsed');
});

// --- render loop ---------------------------------------------------------
let lastFpsUpdate = 0, frames = 0;

function animate(now) {
  requestAnimationFrame(animate);
  controls.update();
  uniformProvider.update(camera);

  const sunDir = new THREE.Vector3(...uniformProvider.sunPosition).normalize();
  sunLight.position.copy(sunDir).multiplyScalar(50);
  sunLight.intensity = Math.max(0.05, sunDir.y) * 1.2;
  skyMat.uniforms.sunDirection.value.copy(sunDir);
  sunMesh.position.copy(sunDir).multiplyScalar(70);
  sunMesh.lookAt(camera.position);
  moonMesh.position.copy(sunDir).multiplyScalar(-70);
  moonMesh.lookAt(camera.position);
  moonMesh.visible = sunDir.y < 0.1;

  pipeline.render({
    worldMeshes: [terrainMesh, propMesh],
    uniformMap: uniformProvider.toMap(),
    atlasTexture,
    lightmapTexture,
  });

  frames++;
  if (now - lastFpsUpdate > 500) {
    $('fps-counter').textContent = `${Math.round((frames * 1000) / (now - lastFpsUpdate))} fps`;
    frames = 0;
    lastFpsUpdate = now;
  }
}

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(animate);

log('info', 'Ready. Upload a shaderpack .zip to preview it, or explore the default lighting.');
log('info', 'Scope note: gbuffers_terrain + composite/final passes are wired up; the shadow pass and non-terrain gbuffers programs are not translated yet.');
