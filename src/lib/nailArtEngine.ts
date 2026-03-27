"use client";

/**
 * Nail art engine using YOLOv8 segmentation ONNX model.
 *
 * Pipeline (photo-based):
 * 1. Load ONNX model via onnxruntime-web
 * 2. Per photo:
 *    a. Draw original image to output canvas at full resolution
 *    b. Auto-correct photo (brightness, contrast, white balance)
 *    c. Preprocess image → 320×320 RGB float32 tensor (BCHW, 0-1 normalized)
 *    d. Run ONNX inference (await)
 *    e. Post-process: NMS on detections → compute instance masks → combine into single nail mask (80×80)
 *    f. Alpha curve shaping (smoothstep)
 *    g. Edge feathering (box blur)
 *    h. Upscale mask to full resolution
 *    i. HSL luminance-preserving color transfer at full resolution
 *    j. Specular highlight per detection bbox
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

// Model constants
const INPUT_SIZE = 320;
const MASK_W = 80;
const MASK_H = 80;
const NUM_DETECTIONS = 2100;
const NUM_MASK_COEFFS = 32;
const CONF_THRESHOLD = 0.5;
const NMS_IOU_THRESHOLD = 0.5;

// Rendering constants
const BLUR_PASSES = 3;
const BLUR_RADIUS = 2;
const ALPHA_THRESHOLD = 0.02;

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

// ---------- Auto photo correction ----------

function autoCorrectPhoto(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const numPixels = w * h;

  // 1. Analyze brightness histogram
  let totalBrightness = 0;
  let rSum = 0,
    gSum = 0,
    bSum = 0;
  for (let i = 0; i < numPixels; i++) {
    const idx = i * 4;
    const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
    totalBrightness += brightness;
    rSum += data[idx];
    gSum += data[idx + 1];
    bSum += data[idx + 2];
  }

  const avgBrightness = totalBrightness / numPixels;
  const avgR = rSum / numPixels;
  const avgG = gSum / numPixels;
  const avgB = bSum / numPixels;

  // 2. Target brightness: 130 (out of 255) — well-lit indoor photo
  const TARGET_BRIGHTNESS = 130;
  const brightnessFactor =
    avgBrightness < 80
      ? TARGET_BRIGHTNESS / avgBrightness // dark photo: brighten
      : avgBrightness > 200
        ? TARGET_BRIGHTNESS / avgBrightness // overexposed: darken
        : 1.0; // acceptable range: no change
  // Clamp factor to reasonable range
  const bf = Math.max(0.7, Math.min(1.8, brightnessFactor));

  // 3. Gray world white balance
  const avgAll = (avgR + avgG + avgB) / 3;
  const wbR = avgAll / (avgR || 1);
  const wbG = avgAll / (avgG || 1);
  const wbB = avgAll / (avgB || 1);
  // Clamp WB factors to prevent extreme shifts
  const clampWB = (v: number) => Math.max(0.8, Math.min(1.2, v));

  // 4. Contrast: slight S-curve (10% contrast boost)
  const CONTRAST = 1.1;

  // 5. Apply all corrections in single pass
  for (let i = 0; i < numPixels; i++) {
    const idx = i * 4;
    let r = data[idx] * bf * clampWB(wbR);
    let g = data[idx + 1] * bf * clampWB(wbG);
    let b = data[idx + 2] * bf * clampWB(wbB);

    // Contrast: remap around 128 midpoint
    r = ((r / 255 - 0.5) * CONTRAST + 0.5) * 255;
    g = ((g / 255 - 0.5) * CONTRAST + 0.5) * 255;
    b = ((b / 255 - 0.5) * CONTRAST + 0.5) * 255;

    data[idx] = Math.max(0, Math.min(255, r)) | 0;
    data[idx + 1] = Math.max(0, Math.min(255, g)) | 0;
    data[idx + 2] = Math.max(0, Math.min(255, b)) | 0;
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---------- Public API ----------

export async function initNailEngine(): Promise<void> {
  if (session) return;

  const ortModule = await loadOrt();
  session = await ortModule.InferenceSession.create("/beauty/models/nails_seg.onnx", {
    executionProviders: ["webgl", "wasm"],
  });
}

export async function processNailPhoto(
  image: HTMLImageElement | HTMLCanvasElement,
  colors: string[],
  pattern: string
): Promise<HTMLCanvasElement> {
  if (!session || !ort) {
    throw new Error("Nail engine not initialized. Call initNailEngine() first.");
  }

  // 1. Create output canvas at original image resolution
  const srcW =
    image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const srcH =
    image instanceof HTMLImageElement ? image.naturalHeight : image.height;

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = srcW;
  outputCanvas.height = srcH;
  const outCtx = outputCanvas.getContext("2d")!;

  // 2. Draw original image to output canvas
  outCtx.drawImage(image, 0, 0, srcW, srcH);

  // 3. Auto-correct the photo (brightness, contrast, white balance)
  autoCorrectPhoto(outCtx, srcW, srcH);

  // 4. Preprocess for ONNX: draw to 320x320
  const preprocessCanvas = document.createElement("canvas");
  preprocessCanvas.width = INPUT_SIZE;
  preprocessCanvas.height = INPUT_SIZE;
  const preprocessCtx = preprocessCanvas.getContext("2d", {
    willReadFrequently: true,
  })!;
  preprocessCtx.drawImage(image, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const imageData = preprocessCtx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const { data } = imageData;

  const inputLen = 3 * INPUT_SIZE * INPUT_SIZE;
  const input = new Float32Array(inputLen);
  const pixelCount = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < pixelCount; i++) {
    input[i] = data[i * 4] / 255; // R
    input[pixelCount + i] = data[i * 4 + 1] / 255; // G
    input[2 * pixelCount + i] = data[i * 4 + 2] / 255; // B
  }

  const tensor = new ort.Tensor("float32", input, [
    1,
    3,
    INPUT_SIZE,
    INPUT_SIZE,
  ]);

  // 5. Run ONNX inference
  let kept: Detection[];
  let output1Data: Float32Array;

  try {
    const results = await session.run({ images: tensor });

    const o0dims = results["output0"].dims;
    const o1dims = results["output1"].dims;
    if (o0dims[1] !== 37 || o0dims[2] !== 2100 || o1dims[1] !== 32) {
      // Dispose tensors
      tensor.dispose?.();
      for (const t of Object.values(results)) {
        (t as any).dispose?.();
      }
      throw new Error(
        `Unexpected ONNX output shape: output0=${o0dims}, output1=${o1dims}`
      );
    }

    const output0Data = results["output0"].data as Float32Array; // [1, 37, 2100]
    output1Data = new Float32Array(
      results["output1"].data as Float32Array
    ); // [1, 32, 80, 80] — copy before disposing

    // Dispose tensors immediately after extracting data
    tensor.dispose?.();
    for (const t of Object.values(results)) {
      (t as any).dispose?.();
    }

    // 6. Parse detections above confidence threshold
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
    kept = nms(detections);
  } catch (e) {
    tensor.dispose?.();
    throw e;
  }

  if (kept.length === 0) {
    // No nails detected — return the auto-corrected photo as-is
    return outputCanvas;
  }

  // 7. Combine all nail detection masks into one (max-merge)
  //    Crop each instance mask to its bounding box to prevent color bleeding
  const combinedMask = new Float32Array(MASK_W * MASK_H);
  const maskScale = MASK_W / INPUT_SIZE; // 80/320 = 0.25

  for (const det of kept) {
    const bx1 = Math.max(0, Math.floor((det.x - det.w / 2) * maskScale));
    const by1 = Math.max(0, Math.floor((det.y - det.h / 2) * maskScale));
    const bx2 = Math.min(MASK_W, Math.ceil((det.x + det.w / 2) * maskScale));
    const by2 = Math.min(MASK_H, Math.ceil((det.y + det.h / 2) * maskScale));

    for (let py = by1; py < by2; py++) {
      for (let px = bx1; px < bx2; px++) {
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

  // 8. Alpha curve shaping (smoothstep, no temporal smoothing)
  const totalMaskPixels = MASK_W * MASK_H;
  const rawMaskCanvas = document.createElement("canvas");
  rawMaskCanvas.width = MASK_W;
  rawMaskCanvas.height = MASK_H;
  const rawMaskCtx = rawMaskCanvas.getContext("2d", {
    willReadFrequently: true,
  })!;

  const rawImageData = rawMaskCtx.createImageData(MASK_W, MASK_H);
  const rd = rawImageData.data;

  for (let i = 0; i < totalMaskPixels; i++) {
    const clamped = Math.max(0, Math.min(1, combinedMask[i]));
    const shapedAlpha =
      clamped * clamped * (3 - 2 * clamped) * Math.pow(clamped, 0.15);

    const idx = i * 4;
    rd[idx] = 255;
    rd[idx + 1] = 255;
    rd[idx + 2] = 255;
    rd[idx + 3] = (shapedAlpha * 255 + 0.5) | 0;
  }

  // 9. Edge feathering: multi-pass box blur
  rawMaskCtx.putImageData(rawImageData, 0, 0);
  const blurredData = rawMaskCtx.getImageData(0, 0, MASK_W, MASK_H);
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = MASK_W;
  tempCanvas.height = MASK_H;
  const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true })!;
  const tempData = tempCtx.createImageData(MASK_W, MASK_H);

  let srcBuf = blurredData.data;
  let dstBuf = tempData.data;

  for (let pass = 0; pass < BLUR_PASSES; pass++) {
    boxBlurHorizontal(srcBuf, dstBuf, MASK_W, MASK_H, BLUR_RADIUS);
    boxBlurVertical(dstBuf, srcBuf, MASK_W, MASK_H, BLUR_RADIUS);
  }

  // srcBuf now contains the final blurred mask alpha at 80x80

  // 10. Upscale mask to original image resolution
  //     Draw 80x80 mask to a canvas, then scale up with bilinear smoothing
  rawMaskCtx.putImageData(blurredData, 0, 0);

  const upscaledMaskCanvas = document.createElement("canvas");
  upscaledMaskCanvas.width = srcW;
  upscaledMaskCanvas.height = srcH;
  const upscaledMaskCtx = upscaledMaskCanvas.getContext("2d", {
    willReadFrequently: true,
  })!;
  upscaledMaskCtx.imageSmoothingEnabled = true;
  upscaledMaskCtx.imageSmoothingQuality = "high";
  upscaledMaskCtx.drawImage(rawMaskCanvas, 0, 0, srcW, srcH);

  const upscaledMaskData = upscaledMaskCtx.getImageData(0, 0, srcW, srcH);
  const maskPixels = upscaledMaskData.data;

  // 11. Apply nail color at full resolution
  const outputImageData = outCtx.getImageData(0, 0, srcW, srcH);
  const outData = outputImageData.data;

  const color1 = parseHexColor(colors[0] || "#cc0000");
  const [targetH1, targetS1, targetL1] = rgbToHsl(
    color1[0],
    color1[1],
    color1[2]
  );

  let color2: [number, number, number] | null = null;
  let targetH2 = 0,
    targetS2 = 0,
    targetL2 = 0;
  if (colors.length > 1) {
    color2 = parseHexColor(colors[1]);
    [targetH2, targetS2, targetL2] = rgbToHsl(color2[0], color2[1], color2[2]);
  }

  const totalOutputPixels = srcW * srcH;

  for (let i = 0; i < totalOutputPixels; i++) {
    const idx = i * 4;
    const maskA = maskPixels[idx + 3] / 255;

    if (maskA < ALPHA_THRESHOLD) continue;

    const origR = outData[idx];
    const origG = outData[idx + 1];
    const origB = outData[idx + 2];
    const [, origS, origL] = rgbToHsl(origR, origG, origB);

    let newH: number;
    let newS: number;
    let tgtL: number;

    // Use pixel Y position normalized to image height for gradient/art patterns
    const py = Math.floor(i / srcW);
    const yNorm = py / (srcH - 1);

    if (pattern === "gradient" && color2) {
      newH = targetH1 + (targetH2 - targetH1) * yNorm;
      newS =
        (targetS1 + (targetS2 - targetS1) * yNorm) * 0.85 + origS * 0.15;
      tgtL = targetL1 + (targetL2 - targetL1) * yNorm;
    } else if (pattern === "art" && color2) {
      const tipThreshold = 0.25;
      if (yNorm < tipThreshold) {
        newH = targetH2;
        newS = targetS2 * 0.85 + origS * 0.15;
        tgtL = targetL2;
      } else {
        newH = targetH1;
        newS = targetS1 * 0.85 + origS * 0.15;
        tgtL = targetL1;
      }
    } else {
      newH = targetH1;
      newS = targetS1 * 0.85 + origS * 0.15;
      tgtL = targetL1;
    }

    // 80% target lightness + 20% original — opaque nail polish with slight texture
    const newL = tgtL * 0.8 + origL * 0.2;

    const [nr, ng, nb] = hslToRgb(newH, newS, newL);

    // Blend using mask alpha
    outData[idx] = (origR * (1 - maskA) + nr * maskA + 0.5) | 0;
    outData[idx + 1] = (origG * (1 - maskA) + ng * maskA + 0.5) | 0;
    outData[idx + 2] = (origB * (1 - maskA) + nb * maskA + 0.5) | 0;
  }

  outCtx.putImageData(outputImageData, 0, 0);

  // 12. Add glossy specular highlight on each detection's bbox
  const scaleX = srcW / INPUT_SIZE;
  const scaleY = srcH / INPUT_SIZE;

  // Use the upscaled mask canvas as a clip for specular highlights
  for (const det of kept) {
    const hlX = det.x * scaleX;
    const hlY = (det.y - det.h * 0.15) * scaleY; // slightly above center
    const hlRadius =
      Math.max(det.w, det.h) * 0.4 * Math.max(scaleX, scaleY);

    outCtx.save();

    // Clip to mask region: use the upscaled mask as a compositing mask
    // We use destination-in approach: draw highlight to a temp canvas masked by nail region
    const hlCanvas = document.createElement("canvas");
    hlCanvas.width = srcW;
    hlCanvas.height = srcH;
    const hlCtx = hlCanvas.getContext("2d")!;

    // Draw radial gradient highlight
    const grad = hlCtx.createRadialGradient(hlX, hlY, 0, hlX, hlY, hlRadius);
    grad.addColorStop(0, "rgba(255,255,255,0.35)");
    grad.addColorStop(0.3, "rgba(255,255,255,0.1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");

    hlCtx.fillStyle = grad;
    hlCtx.fillRect(0, 0, srcW, srcH);

    // Mask the highlight to only show within nail regions
    hlCtx.globalCompositeOperation = "destination-in";
    hlCtx.drawImage(upscaledMaskCanvas, 0, 0);

    // Composite the masked highlight onto the output
    outCtx.drawImage(hlCanvas, 0, 0);
    outCtx.restore();
  }

  // 13. Return the output canvas
  return outputCanvas;
}

/**
 * Generate a nail mask image from a hand photo.
 * Returns a base64 data URL of a black & white mask (white = nails, black = background)
 * at the original image resolution.
 */
export async function generateNailMask(
  image: HTMLImageElement | HTMLCanvasElement
): Promise<string> {
  if (!session || !ort) {
    throw new Error("Nail engine not initialized.");
  }

  const srcW = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const srcH = image instanceof HTMLImageElement ? image.naturalHeight : image.height;

  // 1. Preprocess: draw to 320x320
  const preprocessCanvas = document.createElement("canvas");
  preprocessCanvas.width = INPUT_SIZE;
  preprocessCanvas.height = INPUT_SIZE;
  const preprocessCtx = preprocessCanvas.getContext("2d", { willReadFrequently: true })!;
  preprocessCtx.drawImage(image, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const imageData = preprocessCtx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const { data } = imageData;

  const input = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const pixelCount = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < pixelCount; i++) {
    input[i] = data[i * 4] / 255;
    input[pixelCount + i] = data[i * 4 + 1] / 255;
    input[2 * pixelCount + i] = data[i * 4 + 2] / 255;
  }

  const tensor = new ort.Tensor("float32", input, [1, 3, INPUT_SIZE, INPUT_SIZE]);

  // 2. Run ONNX inference
  const results = await session.run({ images: tensor });
  const o0dims = results["output0"].dims;
  const o1dims = results["output1"].dims;

  if (o0dims[1] !== 37 || o0dims[2] !== 2100 || o1dims[1] !== 32) {
    tensor.dispose?.();
    for (const t of Object.values(results)) (t as any).dispose?.();
    throw new Error("Unexpected ONNX output shape");
  }

  const output0Data = results["output0"].data as Float32Array;
  const output1Data = new Float32Array(results["output1"].data as Float32Array);

  tensor.dispose?.();
  for (const t of Object.values(results)) (t as any).dispose?.();

  // 3. Parse detections + NMS
  const detections: Detection[] = [];
  for (let i = 0; i < NUM_DETECTIONS; i++) {
    const conf = output0Data[4 * NUM_DETECTIONS + i];
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
  const kept = nms(detections);

  // 4. Compute combined mask at 80x80
  const combinedMask = new Float32Array(MASK_W * MASK_H);
  const maskScale = MASK_W / INPUT_SIZE;
  for (const det of kept) {
    const bx1 = Math.max(0, Math.floor((det.x - det.w / 2) * maskScale));
    const by1 = Math.max(0, Math.floor((det.y - det.h / 2) * maskScale));
    const bx2 = Math.min(MASK_W, Math.ceil((det.x + det.w / 2) * maskScale));
    const by2 = Math.min(MASK_H, Math.ceil((det.y + det.h / 2) * maskScale));
    for (let py = by1; py < by2; py++) {
      for (let px = bx1; px < bx2; px++) {
        let val = 0;
        for (let k = 0; k < NUM_MASK_COEFFS; k++) {
          val += det.maskCoeffs[k] * output1Data[k * MASK_W * MASK_H + py * MASK_W + px];
        }
        val = 1 / (1 + Math.exp(-val));
        combinedMask[py * MASK_W + px] = Math.max(combinedMask[py * MASK_W + px], val);
      }
    }
  }

  // 5. Render mask at 80x80 (white nails on black background)
  const maskCanvas80 = document.createElement("canvas");
  maskCanvas80.width = MASK_W;
  maskCanvas80.height = MASK_H;
  const maskCtx80 = maskCanvas80.getContext("2d")!;
  const maskImgData = maskCtx80.createImageData(MASK_W, MASK_H);
  const md = maskImgData.data;
  for (let i = 0; i < MASK_W * MASK_H; i++) {
    const v = combinedMask[i] > 0.5 ? 255 : 0; // binary threshold
    md[i * 4] = v;
    md[i * 4 + 1] = v;
    md[i * 4 + 2] = v;
    md[i * 4 + 3] = 255;
  }
  maskCtx80.putImageData(maskImgData, 0, 0);

  // 6. Upscale to original resolution with smoothing
  const maskCanvasFull = document.createElement("canvas");
  maskCanvasFull.width = srcW;
  maskCanvasFull.height = srcH;
  const maskCtxFull = maskCanvasFull.getContext("2d")!;
  maskCtxFull.imageSmoothingEnabled = true;
  maskCtxFull.imageSmoothingQuality = "high";
  maskCtxFull.drawImage(maskCanvas80, 0, 0, srcW, srcH);

  // 7. Return as base64 data URL
  return maskCanvasFull.toDataURL("image/png");
}

export function destroyNailEngine(): void {
  session?.release();
  session = null;
}
