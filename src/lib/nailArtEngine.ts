"use client";

/**
 * Nail art engine using MediaPipe Hands.
 *
 * Improvements over v1:
 * - More accurate nail region from landmark geometry (tip → DIP midpoint)
 * - Perspective-aware nail shape using fingertip orientation
 * - Multi-pass rendering: base color → gloss → specular highlight
 * - Temporal smoothing to reduce jitter between frames
 * - Per-finger size scaling (thumb wider, pinky narrower)
 */

import {
  HandLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

let handLandmarker: HandLandmarker | null = null;

export async function initNailEngine(): Promise<HandLandmarker> {
  if (handLandmarker) return handLandmarker;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  return handLandmarker;
}

/**
 * Detect whether the back of the hand (dorsal side) is facing the camera.
 * Only the dorsal side has visible nails — palm side should show nothing.
 *
 * Method: compute the cross product of two vectors on the hand plane
 * (wrist→index_mcp × wrist→pinky_mcp). The sign of the z-component,
 * combined with handedness, tells us which side faces the camera.
 *
 * For the front-facing (selfie) camera, the image is mirrored,
 * so we account for that in the logic.
 */
function isBackOfHand(
  landmarks: { x: number; y: number; z: number }[],
  handedness: string // "Left" or "Right" from MediaPipe
): boolean {
  const wrist = landmarks[0];
  const indexMcp = landmarks[5];
  const pinkyMcp = landmarks[17];

  // Vectors on the hand plane (in image coordinates)
  const v1x = indexMcp.x - wrist.x;
  const v1y = indexMcp.y - wrist.y;
  const v2x = pinkyMcp.x - wrist.x;
  const v2y = pinkyMcp.y - wrist.y;

  // 2D cross product (z-component of 3D cross product)
  const cross = v1x * v2y - v1y * v2x;

  // MediaPipe labels hands as seen from the camera's perspective.
  // In a mirrored selfie view:
  // - "Right" hand with cross > 0 → back of hand (nails visible)
  // - "Right" hand with cross < 0 → palm (no nails)
  // - "Left" hand: opposite
  if (handedness === "Right") {
    return cross > 0;
  } else {
    return cross < 0;
  }
}

// Finger definitions with neighbor indices for width estimation
const FINGERS = [
  { tip: 4, dip: 3, pip: 2, mcp: 1, neighborDip: 7, name: "thumb" },   // neighbor: index DIP
  { tip: 8, dip: 7, pip: 6, mcp: 5, neighborDip: 11, name: "index" },   // neighbor: middle DIP
  { tip: 12, dip: 11, pip: 10, mcp: 9, neighborDip: 7, name: "middle" }, // neighbor: index DIP
  { tip: 16, dip: 15, pip: 14, mcp: 13, neighborDip: 11, name: "ring" }, // neighbor: middle DIP
  { tip: 20, dip: 19, pip: 18, mcp: 17, neighborDip: 15, name: "pinky" },// neighbor: ring DIP
];

interface NailRegion {
  cx: number;
  cy: number;
  widthBase: number;  // width at cuticle (DIP end, wider)
  widthTip: number;   // width at free edge (TIP end, narrower)
  height: number;
  angle: number;
  perspective: number; // 0-1, how much the nail faces the camera
  confidence: number;
}

// Temporal smoothing state
const prevRegions: Map<string, NailRegion[]> = new Map();
const SMOOTH_FACTOR = 0.45;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothRegions(
  handKey: string,
  current: NailRegion[]
): NailRegion[] {
  const prev = prevRegions.get(handKey);
  if (!prev || prev.length !== current.length) {
    prevRegions.set(handKey, current.map((r) => ({ ...r })));
    return current;
  }

  const smoothed = current.map((curr, i) => {
    const p = prev[i];
    return {
      cx: lerp(curr.cx, p.cx, SMOOTH_FACTOR),
      cy: lerp(curr.cy, p.cy, SMOOTH_FACTOR),
      widthBase: lerp(curr.widthBase, p.widthBase, SMOOTH_FACTOR),
      widthTip: lerp(curr.widthTip, p.widthTip, SMOOTH_FACTOR),
      height: lerp(curr.height, p.height, SMOOTH_FACTOR),
      angle: lerpAngle(curr.angle, p.angle, SMOOTH_FACTOR),
      perspective: lerp(curr.perspective, p.perspective, SMOOTH_FACTOR),
      confidence: curr.confidence,
    };
  });

  prevRegions.set(handKey, smoothed.map((r) => ({ ...r })));
  return smoothed;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function dist2d(
  a: { x: number; y: number },
  b: { x: number; y: number },
  w: number,
  h: number
): number {
  const dx = (a.x - b.x) * w;
  const dy = (a.y - b.y) * h;
  return Math.sqrt(dx * dx + dy * dy);
}

function getNailRegions(
  landmarks: { x: number; y: number; z: number }[],
  canvasWidth: number,
  canvasHeight: number
): NailRegion[] {
  return FINGERS.map((finger) => {
    const tip = landmarks[finger.tip];
    const dip = landmarks[finger.dip];
    const pip = landmarks[finger.pip];
    const neighbor = landmarks[finger.neighborDip];

    // === Nail center ===
    // Nail sits on the dorsal side of the distal phalanx.
    // Center is ~55% from DIP toward TIP.
    const cx = lerp(dip.x, tip.x, 0.55) * canvasWidth;
    const cy = lerp(dip.y, tip.y, 0.55) * canvasHeight;

    // === Angle ===
    // Use PIP→TIP vector for stable direction (spans 2 joints = less jitter)
    const dx = (tip.x - pip.x) * canvasWidth;
    const dy = (tip.y - pip.y) * canvasHeight;
    const angle = Math.atan2(dy, dx);

    // === Nail height ===
    // Based on DIP-to-TIP distance (the distal phalanx length)
    const phalanxLen = dist2d(dip, tip, canvasWidth, canvasHeight);
    const nailHeight = phalanxLen * 0.88;

    // === Nail width (from neighbor finger spacing) ===
    // The distance between this finger's DIP and the neighbor's DIP
    // gives us an estimate of finger width at the DIP level.
    const interFingerDist = dist2d(dip, neighbor, canvasWidth, canvasHeight);
    // Nail is roughly 60-70% of finger width
    const fingerWidth = interFingerDist * 0.55;
    // Clamp to reasonable range relative to phalanx length
    const clampedWidth = Math.max(
      phalanxLen * 0.35,
      Math.min(fingerWidth, phalanxLen * 0.75)
    );

    // Base (cuticle) is slightly wider than tip (free edge)
    const widthBase = clampedWidth;
    const widthTip = clampedWidth * 0.88;

    // === Perspective ===
    // When the finger points away from camera, the z difference between
    // DIP and TIP is large → nail appears foreshortened.
    // When finger is parallel to camera plane → nail fully visible.
    const zDiff = Math.abs(tip.z - dip.z);
    const perspective = Math.max(0, Math.min(1, 1 - zDiff * 6));

    // Confidence: combine perspective + minimum size threshold
    const confidence = perspective > 0.15 ? perspective : 0;

    return { cx, cy, widthBase, widthTip, height: nailHeight, angle, perspective, confidence };
  });
}

/**
 * Draw anatomically-shaped nail path.
 *
 * Real nail shape:
 * - Cuticle end (bottom): wider, straight or slightly curved
 * - Sides: slightly tapered inward toward the tip
 * - Free edge (top): rounded, with curvature depending on nail type
 *
 * The shape is drawn centered at (0,0) with the free edge at the top (-y)
 * and cuticle at the bottom (+y).
 */
function drawNailShape(
  ctx: CanvasRenderingContext2D,
  wBase: number,
  wTip: number,
  h: number,
  perspective: number
) {
  // Perspective foreshortening: reduce height when viewed at angle
  const effH = h * (0.5 + perspective * 0.5);
  const rTop = wTip * 0.5; // radius for rounded free edge

  ctx.beginPath();

  // Start at bottom-left (cuticle left corner)
  ctx.moveTo(-wBase / 2, effH / 2);

  // Cuticle edge: slight inward curve (lunula shape)
  ctx.quadraticCurveTo(0, effH / 2 + effH * 0.04, wBase / 2, effH / 2);

  // Right side: taper inward from base to tip
  ctx.lineTo(wTip / 2, -effH / 2 + rTop);

  // Free edge right curve
  ctx.quadraticCurveTo(wTip / 2, -effH / 2, wTip / 2 - rTop * 0.6, -effH / 2);

  // Free edge top arc (smooth rounded tip)
  ctx.quadraticCurveTo(0, -effH / 2 - rTop * 0.3, -wTip / 2 + rTop * 0.6, -effH / 2);

  // Free edge left curve
  ctx.quadraticCurveTo(-wTip / 2, -effH / 2, -wTip / 2, -effH / 2 + rTop);

  // Left side: taper back outward from tip to base
  ctx.lineTo(-wBase / 2, effH / 2);

  ctx.closePath();
}

function drawNailOverlay(
  ctx: CanvasRenderingContext2D,
  region: NailRegion,
  colors: string[],
  pattern: string
) {
  const { cx, cy, widthBase: wB, widthTip: wT, height: h, angle, perspective, confidence } = region;

  if (confidence < 0.15 || wB < 2 || h < 2) return;

  const effH = h * (0.5 + perspective * 0.5);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle - Math.PI / 2);

  // === Pass 1: Base color ===
  drawNailShape(ctx, wB, wT, h, perspective);

  if (pattern === "gradient" && colors.length > 1) {
    const grad = ctx.createLinearGradient(0, effH / 2, 0, -effH / 2);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(1, colors[1]);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = colors[0];
  }

  ctx.globalAlpha = 0.78 * confidence;
  ctx.fill();

  // === Pass 2: Clip to nail shape for all subsequent passes ===
  drawNailShape(ctx, wB, wT, h, perspective);
  ctx.clip();

  // === Pass 3: Lunula (half-moon at cuticle) ===
  const avgW = (wB + wT) / 2;
  ctx.globalAlpha = 0.18 * confidence;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.ellipse(0, effH / 2 - effH * 0.05, avgW * 0.35, effH * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // === Pass 4: Glossy highlight (curved specular band) ===
  const glossGrad = ctx.createRadialGradient(
    -avgW * 0.12, -effH * 0.15, 0,
    0, 0, Math.max(effH, avgW) * 0.7
  );
  glossGrad.addColorStop(0, "rgba(255,255,255,0.5)");
  glossGrad.addColorStop(0.2, "rgba(255,255,255,0.2)");
  glossGrad.addColorStop(0.5, "rgba(255,255,255,0.03)");
  glossGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.globalAlpha = 0.55 * confidence;
  ctx.fillStyle = glossGrad;
  ctx.fillRect(-wB, -effH, wB * 2, effH * 2);

  // === Pass 5: Side shadow for depth ===
  const shadowL = ctx.createLinearGradient(-wB / 2, 0, -wB / 2 + avgW * 0.3, 0);
  shadowL.addColorStop(0, "rgba(0,0,0,0.15)");
  shadowL.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = 0.4 * confidence;
  ctx.fillStyle = shadowL;
  ctx.fillRect(-wB, -effH, wB * 2, effH * 2);

  const shadowR = ctx.createLinearGradient(wB / 2, 0, wB / 2 - avgW * 0.3, 0);
  shadowR.addColorStop(0, "rgba(0,0,0,0.12)");
  shadowR.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadowR;
  ctx.fillRect(-wB, -effH, wB * 2, effH * 2);

  // === Pass 6: Glitter particles ===
  if (pattern === "glitter") {
    ctx.globalAlpha = 0.7 * confidence;
    const time = performance.now() * 0.001;
    for (let i = 0; i < 14; i++) {
      const seed = i * 7.31 + Math.floor(time * 2) * 0.1;
      const gx = Math.sin(seed * 3.7) * 0.4 * avgW;
      const gy = Math.cos(seed * 2.3) * 0.4 * effH;
      const gr = 0.6 + Math.sin(seed * 5.1) * 0.5;
      const bright = 0.5 + Math.sin(time * 3 + i) * 0.5;
      ctx.fillStyle = `rgba(255,255,${200 + Math.floor(bright * 55)},${bright * 0.9})`;
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // === Pass 7: French tip ===
  if (pattern === "art" && colors.length > 1) {
    ctx.globalAlpha = 0.9 * confidence;
    const frenchY = -effH / 2 + effH * 0.3;

    ctx.beginPath();
    // Smile line (curved boundary)
    ctx.moveTo(-wT / 2, frenchY);
    ctx.quadraticCurveTo(0, frenchY + effH * 0.05, wT / 2, frenchY);
    // Continue up around free edge
    ctx.lineTo(wT / 2, -effH / 2 + wT * 0.5);
    ctx.quadraticCurveTo(wT / 2, -effH / 2, wT / 2 - wT * 0.5 * 0.6, -effH / 2);
    ctx.quadraticCurveTo(0, -effH / 2 - wT * 0.5 * 0.3, -wT / 2 + wT * 0.5 * 0.6, -effH / 2);
    ctx.quadraticCurveTo(-wT / 2, -effH / 2, -wT / 2, -effH / 2 + wT * 0.5);
    ctx.closePath();
    ctx.fillStyle = colors[1];
    ctx.fill();

    // Smile line
    ctx.globalAlpha = 0.15 * confidence;
    ctx.beginPath();
    ctx.moveTo(-wT / 2, frenchY);
    ctx.quadraticCurveTo(0, frenchY + effH * 0.05, wT / 2, frenchY);
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  ctx.restore();
}

export function renderNailArt(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  colors: string[],
  pattern: string
) {
  const { width, height } = ctx.canvas;

  // Draw mirrored video frame
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -width, 0, width, height);
  ctx.restore();

  if (!handLandmarker) return;

  const result = handLandmarker.detectForVideo(video, performance.now());
  if (!result.landmarks || result.landmarks.length === 0) {
    prevRegions.clear();
    return;
  }

  for (let hi = 0; hi < result.landmarks.length; hi++) {
    const handLandmarks = result.landmarks[hi];
    const handKey = `hand_${hi}`;

    // Determine handedness ("Left" or "Right")
    const handedness =
      result.handednesses?.[hi]?.[0]?.categoryName ?? "Right";

    // Only render nails when the back of the hand (dorsal side) faces the camera
    if (!isBackOfHand(handLandmarks, handedness)) {
      // Palm is facing camera — nails are not visible, skip rendering
      prevRegions.delete(handKey); // reset smoothing so there's no ghost
      continue;
    }

    let nailRegions = getNailRegions(handLandmarks, width, height);

    // Mirror x coordinates (video is horizontally flipped)
    nailRegions = nailRegions.map((r) => ({
      ...r,
      cx: width - r.cx,
      angle: -(r.angle - Math.PI) - Math.PI,
    }));

    // Apply temporal smoothing
    nailRegions = smoothRegions(handKey, nailRegions);

    for (const region of nailRegions) {
      drawNailOverlay(ctx, region, colors, pattern);
    }
  }
}

export function destroyNailEngine() {
  handLandmarker?.close();
  handLandmarker = null;
  prevRegions.clear();
}
