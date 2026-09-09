// uniform-provider.js
//
// Computes the values behind every uniform in constants.js's
// KNOWN_UNIFORMS list, each frame, so translated shader programs get
// real (if simplified) inputs rather than static defaults. Anything a
// pack references that we DON'T model gets bound to a harmless default
// by pipeline.js instead (0 / identity), not by this module.

const DAY_LENGTH_SECONDS = 60; // one full in-scene day/night cycle, sped up for previewing

export class UniformProvider {
  constructor({ canvas }) {
    this.canvas = canvas;
    this.startTime = performance.now();
    this.frameCounter = 0;
    this.previousCameraPosition = new Float32Array(3);
    this.rainStrength = 0; // no weather simulation yet - always clear
    this.wetness = 0;
  }

  /** Call once per frame before rendering. `camera` is a THREE.PerspectiveCamera. */
  update(camera) {
    const now = performance.now();
    const elapsed = (now - this.startTime) / 1000;
    this.frameTimeCounter = elapsed % 1200; // wraps like real Minecraft to avoid float precision loss
    this.frameCounter += 1;

    const dayProgress = (elapsed / DAY_LENGTH_SECONDS) % 1; // 0..1 across a full day
    this.worldTime = Math.floor(dayProgress * 24000); // Minecraft's 0-24000 tick clock
    this.worldDay = Math.floor(elapsed / DAY_LENGTH_SECONDS);
    this.sunAngle = dayProgress; // 0..1, matches OptiFine/Iris convention
    this.shadowAngle = this.sunAngle;

    const sunTheta = dayProgress * Math.PI * 2 - Math.PI / 2;
    this.sunPosition = [Math.cos(sunTheta), Math.sin(sunTheta), 0.2];
    this.moonPosition = this.sunPosition.map((v) => -v);
    // shadowLightPosition = whichever of sun/moon is above the horizon
    this.shadowLightPosition = this.sunPosition[1] > 0 ? this.sunPosition : this.moonPosition;
    this.upPosition = [0, 1, 0];

    this.cameraPosition = camera.position.toArray();

    this.viewWidth = this.canvas.width;
    this.viewHeight = this.canvas.height;
    this.aspectRatio = this.viewWidth / Math.max(1, this.viewHeight);
    this.near = camera.near;
    this.far = camera.far;

    this.isEyeInWater = 0;
    this.eyeAltitude = camera.position.y;
    this.eyeBrightness = [15, 15];
    this.eyeBrightnessSmooth = [15, 15];

    this.entityId = 0;
    this.blockEntityId = 0;
    this.heldItemId = 0;
    this.heldItemId2 = 0;
    this.playerMood = 0;
    this.moonPhase = 0;
    this.nightVision = 0;
    this.blindness = 0;
    this.darknessFactor = 0;
    this.screenBrightness = 1.0;

    // fog / sky - a simple clear-day palette; extend when weather is added
    this.skyColor = [0.29, 0.565, 0.851];
    this.fogColor = [0.7, 0.82, 0.95];
    this.fogDensity = 0.01;
    this.fogStart = 40;
    this.fogEnd = 120;

    this.previousCameraPosition = this.cameraPosition;
  }

  /** Flat map of uniform name -> value, for anything pipeline.js knows how to bind by type. */
  toMap() {
    return {
      frameTimeCounter: this.frameTimeCounter,
      frameCounter: this.frameCounter,
      worldTime: this.worldTime,
      worldDay: this.worldDay,
      moonPhase: this.moonPhase,
      sunAngle: this.sunAngle,
      shadowAngle: this.shadowAngle,
      sunPosition: this.sunPosition,
      moonPosition: this.moonPosition,
      shadowLightPosition: this.shadowLightPosition,
      upPosition: this.upPosition,
      rainStrength: this.rainStrength,
      wetness: this.wetness,
      wetnessCustom: this.wetness,
      cameraPosition: this.cameraPosition,
      previousCameraPosition: this.previousCameraPosition,
      viewWidth: this.viewWidth,
      viewHeight: this.viewHeight,
      aspectRatio: this.aspectRatio,
      near: this.near,
      far: this.far,
      isEyeInWater: this.isEyeInWater,
      eyeAltitude: this.eyeAltitude,
      eyeBrightness: this.eyeBrightness,
      eyeBrightnessSmooth: this.eyeBrightnessSmooth,
      entityId: this.entityId,
      blockEntityId: this.blockEntityId,
      heldItemId: this.heldItemId,
      heldItemId2: this.heldItemId2,
      playerMood: this.playerMood,
      nightVision: this.nightVision,
      blindness: this.blindness,
      darknessFactor: this.darknessFactor,
      screenBrightness: this.screenBrightness,
      skyColor: this.skyColor,
      fogColor: this.fogColor,
      fogDensity: this.fogDensity,
      fogStart: this.fogStart,
      fogEnd: this.fogEnd,
    };
  }
}
