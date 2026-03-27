const express = require("express");
const cors = require("cors");
const { readFileSync, existsSync } = require("fs");
const { join } = require("path");

// Load env
require("dotenv").config({ path: ".env.local" });

const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== "production";

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// API: Nail preview
app.post("/beauty/api/nail-preview", async (req, res) => {
  try {
    const { handPhoto, sampleId } = req.body;

    if (!handPhoto || !sampleId) {
      return res.status(400).json({ error: "Missing handPhoto or sampleId" });
    }

    // Read sample design image from public folder
    const samplePath = join(__dirname, "public", "nail-designs", `sample${sampleId}.jpeg`);
    const sampleBuffer = readFileSync(samplePath);
    const sampleBase64 = sampleBuffer.toString("base64");

    // Strip data URL prefix from hand photo
    const handBase64 = handPhoto.replace(/^data:image\/\w+;base64,/, "");

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-image",
      generationConfig: {
        responseModalities: ["image", "text"],
      },
    });

    console.log(`[nail-preview] Starting Gemini request for sample ${sampleId}...`);
    const startTime = Date.now();
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: handBase64,
        },
      },
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: sampleBase64,
        },
      },
      {
        text: `You are a professional nail art photo editor.

You are given TWO images:
1. FIRST image: A hand photo
2. SECOND image: Nail art film/tip design samples laid out in a row

YOUR TASK: Detect the fingernails in the hand photo, then apply the nail art design from the second image onto those nails.

HAND PHOTO ANALYSIS (first image):
- First, determine the HAND ORIENTATION: which direction is up/down, and whether it's a left or right hand
- The photo may be taken from ANY angle — top-down, side view, palm-up, palm-down, fingers pointing up/down/left/right
- Identify EACH visible finger: thumb, index, middle, ring, pinky
  * Use finger thickness, length, spacing, and position relative to the palm to distinguish them
  * The THUMB is the thickest, shortest, and set apart from the other four fingers
  * The INDEX finger is next to the thumb
  * The MIDDLE finger is the longest
  * The RING finger is between middle and pinky
  * The PINKY is the thinnest and shortest of the four non-thumb fingers
- For EACH nail, identify its orientation:
  * CUTICLE end = where the nail meets the skin near the knuckle
  * FREE EDGE (tip) = the end of the nail furthest from the hand
- ONLY modify the nail areas — keep skin, background, and everything else EXACTLY unchanged
- If only some fingers are visible, only apply to those visible nails
- If no nails are clearly visible, return the original photo unchanged

NAIL FILM SAMPLE ORIENTATION (second image):
- The sample shows 5 nail films laid out VERTICALLY in a row
- Order from LEFT to RIGHT: THUMB, INDEX, MIDDLE, RING, PINKY
- TOP end = CUTICLE side (wider/rounder, attaches near knuckle)
- BOTTOM end = FINGERTIP side (narrower/pointed, the free edge)
- When applying to the hand photo, MATCH ORIENTATION CORRECTLY:
  * TOP of sample nail (cuticle end) → cuticle area of the real nail
  * BOTTOM of sample nail (free edge) → fingertip/free edge of the real nail
  * This mapping must be correct REGARDLESS of the hand photo's rotation or angle
- DO NOT FLIP OR REVERSE the design direction
- Apply each film to its CORRECT finger:
  * Leftmost sample (1st) → THUMB
  * 2nd sample → INDEX finger
  * 3rd sample → MIDDLE finger
  * 4th sample → RING finger
  * Rightmost sample (5th) → PINKY
- If the hand is a LEFT hand vs RIGHT hand, still match thumb-to-thumb, pinky-to-pinky

REPRODUCE THE DESIGN EXACTLY:
- Copy EVERY detail: colors, gradients, patterns, decorations, glitter, metallic parts, 3D elements, jewels, lines, dots
- If the sample has tip decorations (chrome/silver accents, drip effects), they MUST appear at the fingertip
- If the sample has a gradient, preserve its exact direction and color transition
- The design must FULLY COVER each nail from cuticle to tip — no bare nail visible

NAIL SHAPE & LENGTH:
- Match the sample's nail shape: almond, square, round, coffin, stiletto, etc.
- Match the sample's tip thickness exactly
- Match the sample's length proportions
- If sample nails extend past fingertips, result nails should too

COMPOSITION:
- Keep the EXACT same framing, zoom level, and composition
- Do NOT crop or zoom in
- Make it look natural and realistic, like a professional nail salon photo

Return ONLY the edited image.`,
      },
    ]);

    console.log(`[nail-preview] Gemini responded in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    const response = result.response;
    const parts = response.candidates?.[0]?.content?.parts;

    if (!parts) {
      return res.status(500).json({ error: "No response from Gemini" });
    }

    // Find the image part in the response
    for (const part of parts) {
      if (part.inlineData) {
        const imageData = part.inlineData;
        return res.json({
          image: `data:${imageData.mimeType};base64,${imageData.data}`,
        });
      }
    }

    // If no image part, return text error
    const textPart = parts.find((p) => p.text);
    return res.status(500).json(
      { error: textPart?.text || "Gemini did not return an image" }
    );
  } catch (error) {
    console.error("Gemini API error:", error);
    return res.status(500).json(
      { error: error.message || "Internal server error" }
    );
  }
});

async function startServer() {
  if (isDev) {
    // Development: use Vite as middleware (single port!)
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: { server: app } },
      appType: "custom",
    });
    // Vite handles static/HMR + SPA fallback + root redirect (via beautySpa plugin)
    app.use(vite.middlewares);
  } else {
    // Production: serve built files
    app.use("/beauty", express.static(join(__dirname, "dist")));

    app.get("/beauty/{*splat}", (_req, res) => {
      res.sendFile(join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}/beauty/`);
  });
}

startServer();
