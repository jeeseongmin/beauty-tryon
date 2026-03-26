"use client";

/**
 * Nail art engine using YOLOv8 segmentation ONNX model.
 *
 * Pipeline:
 * 1. Load ONNX model via onnxruntime-web
 * 2. Per frame:
 *    a. Draw mirrored video to main canvas
 *    b. Preprocess video frame → 320×320 RGB float32 tensor (BCHW, 0-1 normalized)
 *    c. Run ONNX inference
 *    d. Post-process: NMS on detections → compute instance masks → combine into single nail mask (80×80)
 *    e. Temporal smoothing on the combined mask
 *    f. Alpha curve shaping (smoothstep)
 *    g. Edge feathering (box blur)
 *    h. HSL luminance-preserving color transfer (replace H/S, keep L)
 *    i. Single composite pass (source-over, mirrored)
 */

// Dynamic import for SSR compatibility
let ort: typeof import("onnxruntime-web") | null = null;
async function loadOrt() {
  if (!ort) {
    ort = await import("onnxruntime-web");
    ort.env.wasm.wasmPaths =
      "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/";
  }
  return ort;
}

let session: import("onnxruntime-web").InferenceSession | null = null;

// Offscreen canvases (reused each frame)
let preprocessCanvas: HTMLCanvasElement | null = null;
let preprocessCtx: CanvasRenderingContext2D | null = null;
let rawMaskCanvas: HTMLCanvasElement | null = null;
let rawMaskCtx: CanvasRenderingContext2D | null = null;
let smoothMaskCanvas: HTMLCanvasElement | null = null;
let smoothMaskCtx: CanvasRenderingContext2D | null = null;
let videoSampleCanvas: HTMLCanvasElement | null = null;
let videoSampleCtx: CanvasRenderingContext2D | null = null;
let recolorCanvas: HTMLCanvasElement | null = null;
let recolorCtx: CanvasRenderingContext2D | null = null;

// Temporal smoothing: stores the smoothed mask from the previous frame
let prevAlpha: Float32Array | null = null;

// Model constants
const INPUT_SIZE = 320;
const MASK_W = 80;
const MASK_H = 80;
const NUM_DETECTIONS = 2100;
const NUM_MASK_COEFFS = 32;
const CONF_THRESHOLD = 0.5;
const NMS_IOU_THRESHOLD = 0.5;

// Rendering constants
const TEMPORAL_BLEND = 0.55;
const BLUR_PASSES = 3;
const BLUR_RADIUS = 2;
const ALPHA_THRESHOLD = 0.02;
const OPACITY = 0.65;

// ---------- RGB <-> HSL conversion ----------

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

// ---------- Color parsing ----------

function parseHexColor(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

// ---------- NMS ----------

interface Detection {
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
  maskCoeffs: Float32Array;
}

function iou(a: Detection, b: Detection): number {
  const ax1 = a.x - a.w / 2,
    ay1 = a.y - a.h / 2;
  const ax2 = a.x + a.w / 2,
    ay2 = a.y + a.h / 2;
  const bx1 = b.x - b.w / 2,
    by1 = b.y - b.h / 2;
  const bx2 = b.x + b.w / 2,
    by2 = b.y + b.h / 2;

  const ix1 = Math.max(ax1, bx1),
    iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2),
    iy2 = Math.min(ay2, by2);

  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;

  const areaA = a.w * a.h;
  const areaB = b.w * b.h;

  return inter / (areaA + areaB - inter + 1e-6);
}

function nms(detections: Detection[]): Detection[] {
  // Sort by confidence descending
  detections.sort((a, b) => b.conf - a.conf);

  const keep: Detection[] = [];
  const suppressed = new Set<number>();

  for (let i = 0; i < detections.length; i++) {
    if (suppressed.has(i)) continue;
    keep.push(detections[i]);
    for (let j = i + 1; j < detections.length; j++) {
      if (suppressed.has(j)) continue;
      if (iou(detections[i], detections[j]) > NMS_IOU_THRESHOLD) {
        suppressed.add(j);
      }
    }
  }

  return keep;
}

// ---------- Box blur ----------

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

// ---------- Canvas management ----------

function ensurePreprocessCanvas() {
  if (!preprocessCanvas) {
    preprocessCanvas = document.createElement("canvas");
    preprocessCanvas.width = INPUT_SIZE;
    preprocessCanvas.height = INPUT_SIZE;
    preprocessCtx = preprocessCanvas.getContext("2d", {
      willReadFrequently: true,
    })!;
  }
}

function ensureCanvases(w: number, h: number) {
  if (!rawMaskCanvas || rawMaskCanvas.width !== w) {
    rawMaskCanvas = document.createElement("canvas");
    rawMaskCanvas.width = w;
    rawMaskCanvas.height = h;
    rawMaskCtx = rawMaskCanvas.getContext("2d", { willReadFrequently: true })!;
  }
  if (!smoothMaskCanvas || smoothMaskCanvas.width !== w) {
    smoothMaskCanvas = document.createElement("canvas");
    smoothMaskCanvas.width = w;
    smoothMaskCanvas.height = h;
    smoothMaskCtx = smoothMaskCanvas.getContext("2d", {
      willReadFrequently: true,
    })!;
  }
  if (!videoSampleCanvas || videoSampleCanvas.width !== w) {
    videoSampleCanvas = document.createElement("canvas");
    videoSampleCanvas.width = w;
    videoSampleCanvas.height = h;
    videoSampleCtx = videoSampleCanvas.getContext("2d", {
      willReadFrequently: true,
    })!;
  }
  if (!recolorCanvas || recolorCanvas.width !== w) {
    recolorCanvas = document.createElement("canvas");
    recolorCanvas.width = w;
    recolorCanvas.height = h;
    recolorCtx = recolorCanvas.getContext("2d", { willReadFrequently: true })!;
  }
}

// ---------- Public API ----------

export async function initNailEngine(): Promise<void> {
  if (session) return;

  const ortModule = await loadOrt();
  session = await ortModule.InferenceSession.create("/models/nails_seg.onnx", {
    executionProviders: ["webgl", "wasm"],
  });
}

export function renderNailArt(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  colors: string[],
  pattern: string
): void {
  const vidW = ctx.canvas.width;
  const vidH = ctx.canvas.height;

  // 1. Draw mirrored video to main canvas
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -vidW, 0, vidW, vidH);
  ctx.restore();

  if (!session || !ort) return;

  // 2. Preprocess: draw video to 320×320, extract BCHW float32 tensor
  ensurePreprocessCanvas();
  preprocessCtx!.drawImage(video, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const imageData = preprocessCtx!.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const { data } = imageData;

  const inputLen = 3 * INPUT_SIZE * INPUT_SIZE;
  const input = new Float32Array(inputLen);
  const pixelCount = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < pixelCount; i++) {
    input[i] = data[i * 4] / 255; // R
    input[pixelCount + i] = data[i * 4 + 1] / 255; // G
    input[2 * pixelCount + i] = data[i * 4 + 2] / 255; // B
  }

  const tensor = new ort.Tensor("float32", input, [1, 3, INPUT_SIZE, INPUT_SIZE]);

  // 3. Render cached mask from last completed inference (sync)
  if (cachedCombinedMask) {
    renderMask(cachedCombinedMask, ctx, video, vidW, vidH, colors, pattern);
  }

  // 4. Kick off next inference in background (result stored in cachedCombinedMask)
  runInference(tensor);
}

// Inference result cache for async-to-sync bridge
let pendingInference = false;
let cachedCombinedMask: Float32Array | null = null;

async function runInference(tensor: import("onnxruntime-web").Tensor) {
  if (pendingInference) {
    tensor.dispose?.();
    return;
  }

  pendingInference = true;

  try {
    const results = await session!.run({ images: tensor });

    const o0dims = results["output0"].dims;
    const o1dims = results["output1"].dims;
    if (o0dims[1] !== 37 || o0dims[2] !== 2100 || o1dims[1] !== 32) {
      console.warn("Unexpected ONNX output shape", o0dims, o1dims);
      tensor.dispose?.();
      for (const t of Object.values(results)) {
        (t as any).dispose?.();
      }
      return;
    }

    const output0Data = results["output0"].data as Float32Array; // [1, 37, 2100]
    const output1Data = results["output1"].data as Float32Array; // [1, 32, 80, 80]

    // Dispose tensors immediately after extracting data
    tensor.dispose?.();
    for (const t of Object.values(results)) {
      (t as any).dispose?.();
    }

    // Post-process: collect detections above confidence threshold
    const detections: Detection[] = [];
    for (let i = 0; i < NUM_DETECTIONS; i++) {
      const conf = output0Data[4 * NUM_DETECTIONS + i]; // class score at index 4
      if (conf < CONF_THRESHOLD) continue;

      const x = output0Data[0 * NUM_DETECTIONS + i];
      const y = output0Data[1 * NUM_DETECTIONS + i];
      const w = output0Data[2 * NUM_DETECTIONS + i];
      const h = output0Data[3 * NUM_DETECTIONS + i];

      const maskCoeffs = new Float32Array(NUM_MASK_COEFFS);
      for (let j = 0; j < NUM_MASK_COEFFS; j++) {
        maskCoeffs[j] = output0Data[(5 + j) * NUM_DETECTIONS + i];
      }

      detections.push({ x, y, w, h, conf, maskCoeffs });
    }

    // Apply NMS
    const kept = nms(detections);

    // Combine all nail detection masks into one (max-merge)
    const combinedMask = new Float32Array(MASK_W * MASK_H);

    for (const det of kept) {
      for (let py = 0; py < MASK_H; py++) {
        for (let px = 0; px < MASK_W; px++) {
          let val = 0;
          for (let k = 0; k < NUM_MASK_COEFFS; k++) {
            val +=
              det.maskCoeffs[k] *
              output1Data[k * MASK_W * MASK_H + py * MASK_W + px];
          }
          // Sigmoid
          val = 1 / (1 + Math.exp(-val));
          // Max-merge
          const idx = py * MASK_W + px;
          combinedMask[idx] = Math.max(combinedMask[idx], val);
        }
      }
    }

    // Store result — next renderNailArt call will pick it up
    cachedCombinedMask = combinedMask;
  } catch (e) {
    console.error("Nail inference error:", e);
  } finally {
    pendingInference = false;
  }
}

function renderMask(
  combinedMask: Float32Array,
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  vidW: number,
  vidH: number,
  colors: string[],
  pattern: string
) {
  const totalPixels = MASK_W * MASK_H;

  ensureCanvases(MASK_W, MASK_H);

  // 6. Temporal smoothing + alpha curve shaping
  if (!prevAlpha || prevAlpha.length !== totalPixels) {
    prevAlpha = new Float32Array(totalPixels);
  }

  const rawImageData = rawMaskCtx!.createImageData(MASK_W, MASK_H);
  const rd = rawImageData.data;

  for (let i = 0; i < totalPixels; i++) {
    const currentAlpha = combinedMask[i];

    // Temporal blend
    const smoothedAlpha =
      prevAlpha[i] * TEMPORAL_BLEND + currentAlpha * (1 - TEMPORAL_BLEND);
    prevAlpha[i] = smoothedAlpha;

    // Alpha curve shaping: smoothstep
    const clamped = Math.max(0, Math.min(1, smoothedAlpha));
    const shapedAlpha =
      clamped * clamped * (3 - 2 * clamped) * Math.pow(clamped, 0.15);

    const idx = i * 4;
    rd[idx] = 255;
    rd[idx + 1] = 255;
    rd[idx + 2] = 255;
    rd[idx + 3] = (shapedAlpha * 255 + 0.5) | 0;
  }

  // 7. Edge feathering: multi-pass box blur
  rawMaskCtx!.putImageData(rawImageData, 0, 0);
  const blurredData = rawMaskCtx!.getImageData(0, 0, MASK_W, MASK_H);
  const tempData = smoothMaskCtx!.createImageData(MASK_W, MASK_H);

  let srcBuf = blurredData.data;
  let dstBuf = tempData.data;

  for (let pass = 0; pass < BLUR_PASSES; pass++) {
    boxBlurHorizontal(srcBuf, dstBuf, MASK_W, MASK_H, BLUR_RADIUS);
    boxBlurVertical(dstBuf, srcBuf, MASK_W, MASK_H, BLUR_RADIUS);
  }

  // 8. Sample video at mask resolution
  videoSampleCtx!.drawImage(video, 0, 0, MASK_W, MASK_H);
  const videoPixels = videoSampleCtx!.getImageData(0, 0, MASK_W, MASK_H);
  const vd = videoPixels.data;

  // 9. HSL luminance-preserving color transfer
  const color1 = parseHexColor(colors[0] || "#cc0000");
  const [targetH1, targetS1] = rgbToHsl(color1[0], color1[1], color1[2]);

  let color2: [number, number, number] | null = null;
  let targetH2 = 0,
    targetS2 = 0;
  if (colors.length > 1) {
    color2 = parseHexColor(colors[1]);
    [targetH2, targetS2] = rgbToHsl(color2[0], color2[1], color2[2]);
  }

  const recolorData = recolorCtx!.createImageData(MASK_W, MASK_H);
  const out = recolorData.data;

  const blurAlpha = srcBuf; // final blurred mask

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const maskA = blurAlpha[idx + 3] / 255;

    if (maskA < ALPHA_THRESHOLD) {
      out[idx] = 0;
      out[idx + 1] = 0;
      out[idx + 2] = 0;
      out[idx + 3] = 0;
      continue;
    }

    const origR = vd[idx];
    const origG = vd[idx + 1];
    const origB = vd[idx + 2];
    const [, origS, origL] = rgbToHsl(origR, origG, origB);

    let newH: number;
    let newS: number;

    const py = Math.floor(i / MASK_W);
    const px = i % MASK_W;

    if (pattern === "gradient" && color2) {
      // Interpolate between two colors based on y-position within the mask
      const t = py / (MASK_H - 1);
      newH = targetH1 + (targetH2 - targetH1) * t;
      newS = (targetS1 + (targetS2 - targetS1) * t) * 0.7 + origS * 0.3;
    } else if (pattern === "art" && color2) {
      // French tip: top 25% uses second color, rest uses first
      const tipThreshold = MASK_H * 0.25;
      // In image coordinates, top of nail (free edge) is at lower y values
      // But since the mask is from the model directly, we treat top rows as tip
      if (py < tipThreshold) {
        newH = targetH2;
        newS = targetS2 * 0.7 + origS * 0.3;
      } else {
        newH = targetH1;
        newS = targetS1 * 0.7 + origS * 0.3;
      }
    } else {
      // Solid color
      newH = targetH1;
      newS = targetS1 * 0.7 + origS * 0.3;
    }

    const newL = origL; // preserve original lightness

    const [nr, ng, nb] = hslToRgb(newH, newS, newL);

    out[idx] = nr;
    out[idx + 1] = ng;
    out[idx + 2] = nb;
    out[idx + 3] = (maskA * OPACITY * 255 + 0.5) | 0;
  }

  // 10. Glitter overlay: add sparkle dots onto the recolor buffer
  if (pattern === "glitter") {
    const time = performance.now() * 0.001;
    for (let si = 0; si < 40; si++) {
      const seed = si * 7.31 + Math.floor(time * 2) * 0.1;
      const gx = Math.floor(
        ((Math.sin(seed * 3.7) * 0.5 + 0.5) * MASK_W) % MASK_W
      );
      const gy = Math.floor(
        ((Math.cos(seed * 2.3) * 0.5 + 0.5) * MASK_H) % MASK_H
      );
      const bright = 0.5 + Math.sin(time * 3 + si) * 0.5;

      const gi = gy * MASK_W + gx;
      const gIdx = gi * 4;
      const gMaskA = blurAlpha[gIdx + 3] / 255;
      if (gMaskA < 0.3) continue; // only add glitter where nail mask is present

      // Blend sparkle on top
      const sparkleAlpha = bright * 0.7 * gMaskA;
      const sparkleR = 255;
      const sparkleG = 255;
      const sparkleB = 200 + Math.floor(bright * 55);

      out[gIdx] = Math.min(
        255,
        Math.floor(out[gIdx] * (1 - sparkleAlpha) + sparkleR * sparkleAlpha)
      );
      out[gIdx + 1] = Math.min(
        255,
        Math.floor(
          out[gIdx + 1] * (1 - sparkleAlpha) + sparkleG * sparkleAlpha
        )
      );
      out[gIdx + 2] = Math.min(
        255,
        Math.floor(
          out[gIdx + 2] * (1 - sparkleAlpha) + sparkleB * sparkleAlpha
        )
      );
      // Keep existing alpha (don't increase beyond mask boundary)
    }
  }

  recolorCtx!.putImageData(recolorData, 0, 0);

  // 11. Single composite pass: draw recolored image (mirrored) onto the main canvas
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalCompositeOperation = "source-over";
  ctx.scale(-1, 1);
  ctx.drawImage(recolorCanvas!, -vidW, 0, vidW, vidH);
  ctx.restore();
}

export function destroyNailEngine(): void {
  session?.release();
  session = null;
  preprocessCanvas = null;
  preprocessCtx = null;
  rawMaskCanvas = null;
  rawMaskCtx = null;
  smoothMaskCanvas = null;
  smoothMaskCtx = null;
  videoSampleCanvas = null;
  videoSampleCtx = null;
  recolorCanvas = null;
  recolorCtx = null;
  prevAlpha = null;
  cachedCombinedMask = null;
  pendingInference = false;
}
