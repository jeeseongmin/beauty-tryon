"use client";

/**
 * Hair color engine using MediaPipe Image Segmenter (multiclass).
 *
 * Uses the selfie_multiclass model:
 *   0: background, 1: hair, 2: body-skin, 3: face-skin, 4: clothes, 5: others
 *
 * Key techniques for quality:
 * - Confidence masks: continuous 0.0-1.0 probability per pixel (not binary)
 * - HSL luminance-preserving color transfer: only hue/saturation change, lightness stays
 * - Temporal smoothing: blend current mask alpha with previous frames to eliminate flicker
 * - Edge feathering: multi-pass box blur on the alpha channel for soft, natural edges
 * - Alpha curve shaping: non-linear alpha transform for natural hair density falloff
 * - Single composite pass: no triple multiply/overlay/screen layers
 */

import {
  ImageSegmenter,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

let segmenter: ImageSegmenter | null = null;

// Offscreen canvases (reused each frame)
let rawMaskCanvas: HTMLCanvasElement | null = null;
let rawMaskCtx: CanvasRenderingContext2D | null = null;
let smoothMaskCanvas: HTMLCanvasElement | null = null;
let smoothMaskCtx: CanvasRenderingContext2D | null = null;
let videoSampleCanvas: HTMLCanvasElement | null = null;
let videoSampleCtx: CanvasRenderingContext2D | null = null;
let recolorCanvas: HTMLCanvasElement | null = null;
let recolorCtx: CanvasRenderingContext2D | null = null;

// Temporal smoothing: stores the smoothed alpha mask from the previous frame
let prevAlpha: Float32Array | null = null;

const HAIR_CATEGORY = 1;
// How much of the previous frame to keep (higher = smoother but laggier)
const TEMPORAL_BLEND = 0.55;
// Number of box-blur passes for edge feathering (more = softer edges)
const BLUR_PASSES = 3;
// Blur radius in pixels (at mask resolution, so 2px ≈ 5px at video resolution)
const BLUR_RADIUS = 2;
// Minimum alpha to consider for recoloring
const ALPHA_THRESHOLD = 0.02;

// ---------- RGB <-> HSL conversion (inline, no allocations) ----------

/**
 * Convert RGB (0-255) to HSL. Returns [h (0-360), s (0-1), l (0-1)].
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, l];
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  } else if (max === g) {
    h = ((b - r) / d + 2) * 60;
  } else {
    h = ((r - g) / d + 4) * 60;
  }

  return [h, s, l];
}

function hueToRgbChannel(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/**
 * Convert HSL back to RGB (0-255).
 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = (l * 255 + 0.5) | 0;
    return [v, v, v];
  }

  const hNorm = h / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const r = (hueToRgbChannel(p, q, hNorm + 1 / 3) * 255 + 0.5) | 0;
  const g = (hueToRgbChannel(p, q, hNorm) * 255 + 0.5) | 0;
  const b = (hueToRgbChannel(p, q, hNorm - 1 / 3) * 255 + 0.5) | 0;

  return [r, g, b];
}

// -----------------------------------------------------------------------

export async function initHairEngine(): Promise<ImageSegmenter> {
  if (segmenter) return segmenter;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });

  return segmenter;
}

function ensureCanvases(maskW: number, maskH: number) {
  // Canvas at mask resolution for raw mask alpha
  if (!rawMaskCanvas || rawMaskCanvas.width !== maskW) {
    rawMaskCanvas = document.createElement("canvas");
    rawMaskCanvas.width = maskW;
    rawMaskCanvas.height = maskH;
    rawMaskCtx = rawMaskCanvas.getContext("2d", { willReadFrequently: true })!;
  }
  // Canvas at mask resolution for smoothed/blurred mask
  if (!smoothMaskCanvas || smoothMaskCanvas.width !== maskW) {
    smoothMaskCanvas = document.createElement("canvas");
    smoothMaskCanvas.width = maskW;
    smoothMaskCanvas.height = maskH;
    smoothMaskCtx = smoothMaskCanvas.getContext("2d", { willReadFrequently: true })!;
  }
  // Canvas at mask resolution to sample downscaled video
  if (!videoSampleCanvas || videoSampleCanvas.width !== maskW) {
    videoSampleCanvas = document.createElement("canvas");
    videoSampleCanvas.width = maskW;
    videoSampleCanvas.height = maskH;
    videoSampleCtx = videoSampleCanvas.getContext("2d", { willReadFrequently: true })!;
  }
  // Canvas at mask resolution for the recolored result
  if (!recolorCanvas || recolorCanvas.width !== maskW) {
    recolorCanvas = document.createElement("canvas");
    recolorCanvas.width = maskW;
    recolorCanvas.height = maskH;
    recolorCtx = recolorCanvas.getContext("2d", { willReadFrequently: true })!;
  }
}

/**
 * Apply horizontal box blur on alpha channel of an ImageData buffer.
 */
function boxBlurHorizontal(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  r: number
) {
  const diameter = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) {
      const sx = Math.min(Math.max(x, 0), w - 1);
      sum += src[(y * w + sx) * 4 + 3];
    }
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      dst[idx + 3] = (sum / diameter) | 0;
      dst[idx] = src[idx];
      dst[idx + 1] = src[idx + 1];
      dst[idx + 2] = src[idx + 2];
      const removeX = Math.min(Math.max(x - r, 0), w - 1);
      const addX = Math.min(Math.max(x + r + 1, 0), w - 1);
      sum -= src[(y * w + removeX) * 4 + 3];
      sum += src[(y * w + addX) * 4 + 3];
    }
  }
}

/**
 * Apply vertical box blur on alpha channel of an ImageData buffer.
 */
function boxBlurVertical(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  r: number
) {
  const diameter = r * 2 + 1;
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) {
      const sy = Math.min(Math.max(y, 0), h - 1);
      sum += src[(sy * w + x) * 4 + 3];
    }
    for (let y = 0; y < h; y++) {
      const idx = (y * w + x) * 4;
      dst[idx + 3] = (sum / diameter) | 0;
      dst[idx] = src[idx];
      dst[idx + 1] = src[idx + 1];
      dst[idx + 2] = src[idx + 2];
      const removeY = Math.min(Math.max(y - r, 0), h - 1);
      const addY = Math.min(Math.max(y + r + 1, 0), h - 1);
      sum -= src[(removeY * w + x) * 4 + 3];
      sum += src[(addY * w + x) * 4 + 3];
    }
  }
}

export function renderHairColor(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  color: [number, number, number],
  opacity: number = 0.55
) {
  const vidW = ctx.canvas.width;
  const vidH = ctx.canvas.height;

  // 1. Draw mirrored video to main canvas
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -vidW, 0, vidW, vidH);
  ctx.restore();

  if (!segmenter) return;

  // 2. Segment using confidence masks
  const result = segmenter.segmentForVideo(video, performance.now());
  const confidenceMasks = result.confidenceMasks;
  if (!confidenceMasks || confidenceMasks.length <= HAIR_CATEGORY) return;

  const hairMask = confidenceMasks[HAIR_CATEGORY];
  const maskFloat = hairMask.getAsFloat32Array();
  const maskW = hairMask.width;
  const maskH = hairMask.height;
  const totalPixels = maskW * maskH;

  ensureCanvases(maskW, maskH);

  // 3. Temporal smoothing + alpha curve shaping
  if (!prevAlpha || prevAlpha.length !== totalPixels) {
    prevAlpha = new Float32Array(totalPixels);
  }

  // Build the alpha mask into an ImageData for blur processing
  const rawImageData = rawMaskCtx!.createImageData(maskW, maskH);
  const rd = rawImageData.data;

  for (let i = 0; i < totalPixels; i++) {
    const currentAlpha = maskFloat[i]; // continuous 0.0-1.0 confidence

    // Temporal blend: smoothly transition between frames
    const smoothedAlpha =
      prevAlpha[i] * TEMPORAL_BLEND + currentAlpha * (1 - TEMPORAL_BLEND);
    prevAlpha[i] = smoothedAlpha;

    // Alpha curve shaping: smooth S-curve for natural density falloff
    // Uses a single continuous function (no discontinuity):
    //   smoothstep for soft outer tail + pow for inner sharpening
    const clamped = Math.max(0, Math.min(1, smoothedAlpha));
    // Smoothstep: 3x² - 2x³ — maps 0-1 to 0-1 with smooth acceleration/deceleration
    const shapedAlpha = clamped * clamped * (3 - 2 * clamped) * Math.pow(clamped, 0.15);

    const idx = i * 4;
    // Store a white pixel with the shaped alpha — the actual color is applied per-pixel later
    rd[idx] = 255;
    rd[idx + 1] = 255;
    rd[idx + 2] = 255;
    rd[idx + 3] = (shapedAlpha * 255 + 0.5) | 0;
  }

  // 4. Edge feathering: multi-pass box blur on the alpha channel
  rawMaskCtx!.putImageData(rawImageData, 0, 0);
  const blurredData = rawMaskCtx!.getImageData(0, 0, maskW, maskH);
  const tempData = smoothMaskCtx!.createImageData(maskW, maskH);

  let srcBuf = blurredData.data;
  let dstBuf = tempData.data;

  for (let pass = 0; pass < BLUR_PASSES; pass++) {
    boxBlurHorizontal(srcBuf, dstBuf, maskW, maskH, BLUR_RADIUS);
    boxBlurVertical(dstBuf, srcBuf, maskW, maskH, BLUR_RADIUS);
  }

  // blurredData.data (srcBuf) now contains the final blurred alpha mask

  // 5. Draw downscaled video frame to the video sample canvas (mask resolution)
  videoSampleCtx!.drawImage(video, 0, 0, maskW, maskH);
  const videoPixels = videoSampleCtx!.getImageData(0, 0, maskW, maskH);
  const vd = videoPixels.data;

  // 6. HSL luminance-preserving color transfer
  //    Pre-compute target color HSL
  const [targetH, targetS] = rgbToHsl(color[0], color[1], color[2]);

  const recolorData = recolorCtx!.createImageData(maskW, maskH);
  const out = recolorData.data;

  const blurAlpha = srcBuf; // blurred mask alpha lives in srcBuf (blurredData.data)

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const maskA = blurAlpha[idx + 3] / 255; // 0.0-1.0

    if (maskA < ALPHA_THRESHOLD) {
      // Fully transparent — skip
      out[idx] = 0;
      out[idx + 1] = 0;
      out[idx + 2] = 0;
      out[idx + 3] = 0;
      continue;
    }

    // Read the original video pixel
    const origR = vd[idx];
    const origG = vd[idx + 1];
    const origB = vd[idx + 2];

    // Convert to HSL
    const [, origS, origL] = rgbToHsl(origR, origG, origB);

    // Replace hue entirely, blend saturation (70% target, 30% original), keep lightness
    const newH = targetH;
    const newS = targetS * 0.7 + origS * 0.3;
    const newL = origL; // preserve original lightness completely

    // Convert back to RGB
    const [nr, ng, nb] = hslToRgb(newH, newS, newL);

    out[idx] = nr;
    out[idx + 1] = ng;
    out[idx + 2] = nb;
    out[idx + 3] = (maskA * opacity * 255 + 0.5) | 0;
  }

  recolorCtx!.putImageData(recolorData, 0, 0);

  // 7. Single composite pass: draw the recolored image (mirrored) onto the main canvas
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalCompositeOperation = "source-over";
  ctx.scale(-1, 1);
  ctx.drawImage(recolorCanvas!, -vidW, 0, vidW, vidH);
  ctx.restore();

  // Clean up all MediaPipe confidence masks to prevent GPU memory leak
  for (const mask of confidenceMasks) {
    mask.close();
  }
}

export function destroyHairEngine() {
  segmenter?.close();
  segmenter = null;
  rawMaskCanvas = null;
  rawMaskCtx = null;
  smoothMaskCanvas = null;
  smoothMaskCtx = null;
  videoSampleCanvas = null;
  videoSampleCtx = null;
  recolorCanvas = null;
  recolorCtx = null;
  prevAlpha = null;
}
