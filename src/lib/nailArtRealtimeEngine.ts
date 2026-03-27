"use client";

/**
 * Real-time nail art overlay engine using MediaPipe HandLandmarker.
 *
 * Performance-optimized for live video:
 * - Direct hex color rendering (no per-pixel HSL conversion)
 * - Temporal smoothing with SMOOTH_FACTOR = 0.12 for responsive tracking
 * - Palm/dorsal detection with hysteresis to prevent flicker
 * - Anatomically correct nail shapes with perspective foreshortening
 * - 2-pass rendering: multiply tint + opaque color overlay
 * - Pattern support: solid, gradient, glitter, art (french tip)
 */

import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NailRegion {
  cx: number;
  cy: number;
  widthBase: number;
  widthTip: number;
  height: number;
  angle: number;
  perspective: number;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let handLandmarker: HandLandmarker | null = null;

/** Previous smoothed nail regions keyed by `${handKey}_${fingerName}` */
const prevRegions = new Map<string, NailRegion>();

/** Previous back-of-hand boolean keyed by handKey, for hysteresis */
const prevBackOfHand = new Map<string, boolean>();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SMOOTH_FACTOR = 0.12;
const HYSTERESIS_DEAD_ZONE = 0.01;

const FINGERS = [
  { tip: 4, dip: 3, pip: 2, mcp: 1, name: "thumb" },
  { tip: 8, dip: 7, pip: 6, mcp: 5, name: "index" },
  { tip: 12, dip: 11, pip: 10, mcp: 9, name: "middle" },
  { tip: 16, dip: 15, pip: 14, mcp: 13, name: "ring" },
  { tip: 20, dip: 19, pip: 18, mcp: 17, name: "pinky" },
] as const;

const FINGER_NAIL_WIDTH_RATIO: Record<string, number> = {
  thumb: 0.75,
  index: 0.52,
  middle: 0.50,
  ring: 0.48,
  pinky: 0.45,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseHexColor(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRegion(prev: NailRegion, curr: NailRegion, t: number): NailRegion {
  return {
    cx: lerp(prev.cx, curr.cx, t),
    cy: lerp(prev.cy, curr.cy, t),
    widthBase: lerp(prev.widthBase, curr.widthBase, t),
    widthTip: lerp(prev.widthTip, curr.widthTip, t),
    height: lerp(prev.height, curr.height, t),
    angle: lerp(prev.angle, curr.angle, t),
    perspective: lerp(prev.perspective, curr.perspective, t),
    confidence: curr.confidence,
  };
}

// ---------------------------------------------------------------------------
// Palm / dorsal detection with hysteresis
// ---------------------------------------------------------------------------

function isBackOfHand(
  landmarks: { x: number; y: number; z: number }[],
  handedness: string,
  handKey: string
): boolean {
  // Wrist = 0, Index MCP = 5, Pinky MCP = 17
  const wrist = landmarks[0];
  const indexMcp = landmarks[5];
  const pinkyMcp = landmarks[17];

  const v1x = indexMcp.x - wrist.x;
  const v1y = indexMcp.y - wrist.y;
  const v2x = pinkyMcp.x - wrist.x;
  const v2y = pinkyMcp.y - wrist.y;

  // Cross product z-component: v1 x v2
  const cross = v1x * v2y - v1y * v2x;

  // MediaPipe handedness in selfie view:
  // "Right" + cross > 0 → back of hand (nails visible)
  // "Left" + cross < 0 → back of hand (nails visible)
  const rawBack = handedness === "Right" ? cross > 0 : cross < 0;

  // Hysteresis: only flip state if cross magnitude exceeds dead zone
  const prev = prevBackOfHand.get(handKey);
  if (prev !== undefined && Math.abs(cross) < HYSTERESIS_DEAD_ZONE) {
    return prev;
  }

  prevBackOfHand.set(handKey, rawBack);
  return rawBack;
}

// ---------------------------------------------------------------------------
// Nail region computation
// ---------------------------------------------------------------------------

function computeNailRegion(
  landmarks: { x: number; y: number; z: number }[],
  finger: (typeof FINGERS)[number],
  w: number,
  h: number,
  confidence: number
): NailRegion {
  const tip = landmarks[finger.tip];
  const dip = landmarks[finger.dip];
  const pip = landmarks[finger.pip];

  // Nail center: lerp between DIP and TIP at 0.42
  const cx = lerp(dip.x, tip.x, 0.42) * w;
  const cy = lerp(dip.y, tip.y, 0.42) * h;

  // Angle from PIP to TIP for stability
  const angle = Math.atan2(
    (tip.y - pip.y) * h,
    (tip.x - pip.x) * w
  );

  // Phalanx length (DIP to TIP) in pixels
  const dx = (tip.x - dip.x) * w;
  const dy = (tip.y - dip.y) * h;
  const phalanxLength = Math.sqrt(dx * dx + dy * dy);

  // Nail dimensions
  const nailWidth = phalanxLength * FINGER_NAIL_WIDTH_RATIO[finger.name];
  const widthBase = nailWidth;
  const widthTip = nailWidth * 0.88;
  const nailHeight = phalanxLength * 0.65;

  // Perspective foreshortening based on z-depth difference
  const zDiff = Math.abs(tip.z - dip.z);
  const perspective = Math.max(0.3, Math.min(1.0, 1 - zDiff * 2.5));

  return {
    cx,
    cy,
    widthBase,
    widthTip,
    height: nailHeight,
    angle,
    perspective,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Nail shape path (anatomically correct)
// ---------------------------------------------------------------------------

function drawNailPath(
  ctx: CanvasRenderingContext2D,
  region: NailRegion,
  mirrored: boolean
): void {
  const { cx, cy, widthBase, widthTip, height, perspective } = region;
  const angle = mirrored ? Math.PI - region.angle : region.angle;

  const effH = height * perspective;
  const halfBase = widthBase / 2;
  const halfTip = widthTip / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);

  ctx.beginPath();

  // Cuticle (bottom) — curves slightly inward
  const cuticleInset = effH * 0.06;
  ctx.moveTo(-halfBase, 0);
  ctx.quadraticCurveTo(0, cuticleInset, halfBase, 0);

  // Right side
  ctx.lineTo(halfTip, -effH * 0.75);

  // Free edge (top) — rounded
  ctx.quadraticCurveTo(halfTip * 0.6, -effH, 0, -effH);
  ctx.quadraticCurveTo(-halfTip * 0.6, -effH, -halfTip, -effH * 0.75);

  // Left side
  ctx.lineTo(-halfBase, 0);

  ctx.closePath();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Pattern rendering
// ---------------------------------------------------------------------------

function applyPattern(
  ctx: CanvasRenderingContext2D,
  region: NailRegion,
  mirrored: boolean,
  colors: string[],
  pattern: string
): void {
  const { cx, cy, height, perspective } = region;
  const angle = mirrored ? Math.PI - region.angle : region.angle;
  const effH = height * perspective;
  const color1 = colors[0] || "#cc0000";
  const color2 = colors[1] || color1;

  switch (pattern) {
    case "gradient": {
      // Linear gradient along nail height
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      const grad = ctx.createLinearGradient(0, 0, 0, -effH);
      grad.addColorStop(0, color1);
      grad.addColorStop(1, color2);
      ctx.fillStyle = grad;
      ctx.restore();
      // Path is already set — just need fillStyle
      // Re-draw path since save/restore cleared transform
      drawNailPath(ctx, region, mirrored);
      ctx.fillStyle = grad;
      ctx.fill();
      return;
    }

    case "art": {
      // French tip: bottom 72% = color1, top 28% = color2 with curved smile line
      ctx.fillStyle = color1;
      ctx.fill();

      // Draw the french tip overlay
      const halfTip = region.widthTip / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      ctx.beginPath();
      const tipStart = -effH * 0.72;

      ctx.moveTo(-halfTip, tipStart);
      // Smile line curve
      ctx.quadraticCurveTo(0, tipStart - effH * 0.08, halfTip, tipStart);
      ctx.lineTo(halfTip * 0.6, -effH);
      ctx.quadraticCurveTo(halfTip * 0.3, -effH * 1.02, 0, -effH);
      ctx.quadraticCurveTo(-halfTip * 0.3, -effH * 1.02, -halfTip * 0.6, -effH);
      ctx.lineTo(-halfTip, tipStart);
      ctx.closePath();

      ctx.fillStyle = color2;
      ctx.fill();
      ctx.restore();
      return;
    }

    case "glitter": {
      // Base color
      ctx.fillStyle = color1;
      ctx.fill();

      // 6 sparkle dots with time-based animation
      const time = performance.now() * 0.003;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      for (let i = 0; i < 6; i++) {
        const t = i / 6;
        const sparkleX = (Math.sin(t * Math.PI * 4 + time) * region.widthBase * 0.3);
        const sparkleY = -effH * (0.15 + t * 0.7);
        const size = 1.2 + Math.sin(time + i * 1.7) * 0.6;
        const alpha = 0.5 + Math.sin(time * 1.3 + i * 2.1) * 0.3;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(sparkleX, sparkleY, size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
      return;
    }

    default: {
      // solid
      ctx.fillStyle = color1;
      ctx.fill();
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function initRealtimeNailEngine(): Promise<void> {
  if (handLandmarker) return;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

export function renderRealtimeNailArt(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  colors: string[],
  pattern: string
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  // Draw mirrored video frame first
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -w, 0, w, h);
  ctx.restore();

  if (!handLandmarker) return;

  // Detect hands
  const result = handLandmarker.detectForVideo(video, performance.now());
  if (!result.landmarks || result.landmarks.length === 0) return;

  for (let hi = 0; hi < result.landmarks.length; hi++) {
    const landmarks = result.landmarks[hi];
    const handedness =
      result.handednesses?.[hi]?.[0]?.categoryName ?? "Right";
    const handKey = `hand_${handedness}`;
    const confidence = result.handednesses?.[hi]?.[0]?.score ?? 0.8;

    // Only render nails when back of hand is visible
    const backOfHand = isBackOfHand(landmarks, handedness, handKey);
    if (!backOfHand) continue;

    // Process each finger
    for (const finger of FINGERS) {
      const regionKey = `${handKey}_${finger.name}`;

      // Compute raw nail region (in original video coordinates)
      const rawRegion = computeNailRegion(
        landmarks,
        finger,
        w,
        h,
        confidence
      );

      // Mirror to match the flipped video display
      rawRegion.cx = w - rawRegion.cx;
      rawRegion.angle = Math.PI - rawRegion.angle;

      // Temporal smoothing
      const prev = prevRegions.get(regionKey);
      const smoothed = prev
        ? lerpRegion(prev, rawRegion, SMOOTH_FACTOR)
        : rawRegion;
      prevRegions.set(regionKey, smoothed);

      // --- Pass 1: Multiply tint (skin-through color) ---
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = 0.25 * smoothed.confidence;
      drawNailPath(ctx, smoothed, true);
      ctx.fillStyle = colors[0] || "#cc0000";
      ctx.fill();
      ctx.restore();

      // --- Pass 2: Opaque color overlay with edge feathering ---
      ctx.save();

      // Edge feathering shadow — set BEFORE fill
      ctx.shadowColor = "rgba(0,0,0,0.1)";
      ctx.shadowBlur = 1.5;

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.9 * smoothed.confidence;

      // Draw nail path and apply pattern
      if (pattern === "solid" || !pattern) {
        drawNailPath(ctx, smoothed, true);
        ctx.fillStyle = colors[0] || "#cc0000";
        ctx.fill();
      } else {
        applyPattern(ctx, smoothed, true, colors, pattern);
      }

      // Reset shadow
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      ctx.restore();
    }
  }
}

export function destroyRealtimeNailEngine(): void {
  handLandmarker?.close();
  handLandmarker = null;
  prevRegions.clear();
  prevBackOfHand.clear();
}
