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
    const { handPhoto, maskImage, sampleId } = req.body;

    if (!handPhoto || !maskImage || !sampleId) {
      return res.status(400).json({ error: "Missing handPhoto, maskImage, or sampleId" });
    }

    // Read sample design image from public folder
    const samplePath = join(__dirname, "public", "nail-designs", `sample${sampleId}.jpeg`);
    const sampleBuffer = readFileSync(samplePath);
    const sampleBase64 = sampleBuffer.toString("base64");

    // Strip data URL prefix from hand photo and mask
    const handBase64 = handPhoto.replace(/^data:image\/\w+;base64,/, "");
    const maskBase64 = maskImage.replace(/^data:image\/\w+;base64,/, "");

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-image",
      generationConfig: {
        responseModalities: ["image", "text"],
      },
    });

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: handBase64,
        },
      },
      {
        inlineData: {
          mimeType: "image/png",
          data: maskBase64,
        },
      },
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: sampleBase64,
        },
      },
      {
        text: `You are a professional nail art inpainting editor.

You are given THREE images:
1. FIRST image: Original hand photo
2. SECOND image: A mask image where WHITE areas = nail regions, BLACK areas = everything else
3. THIRD image: Nail art film/tip design samples laid out in a row

INPAINTING RULE: ONLY modify the WHITE areas in the mask (the nails). Keep ALL black-masked areas (skin, background, everything else) EXACTLY unchanged from the original photo. The mask precisely defines where nails are — trust it completely.

CRITICAL — ORIENTATION OF THE NAIL FILM SAMPLES (third image):
- The third image shows 5 nail films laid out VERTICALLY in a row
- Order from LEFT to RIGHT: THUMB, INDEX, MIDDLE, RING, PINKY
- EACH NAIL FILM HAS TWO ENDS:
  * TOP end (in the sample image) = CUTICLE side = the end that attaches near the knuckle = WIDER/ROUNDER
  * BOTTOM end (in the sample image) = FINGERTIP side = the free edge = NARROWER/POINTED
- When applying to the hand photo:
  * The TOP of the sample nail → goes toward the KNUCKLE (cuticle area) on the real finger
  * The BOTTOM of the sample nail → goes toward the FINGERTIP on the real finger
- DO NOT FLIP OR REVERSE the nail design. If the sample has decorations at the BOTTOM (fingertip end), those decorations MUST appear at the FINGERTIP of the result, NOT at the cuticle.
- If the sample has a gradient that goes from light (top/cuticle) to dark (bottom/tip), the result must ALSO go from light (cuticle) to dark (tip). NEVER reverse the gradient direction.
- Apply each film to the CORRECT finger: thumb design → thumb nail, index design → index nail, etc.

Apply the nail art design from the third image onto ONLY the white-masked nail areas in the first image.
- ONLY modify pixels that fall within the WHITE mask regions
- Everything outside the white mask must remain pixel-perfect identical to the original photo

CRITICAL — REPRODUCE THE DESIGN EXACTLY:
- Copy EVERY detail from the sample: colors, gradients, patterns, decorations, glitter, metallic parts, 3D elements, jewels, lines, dots — everything visible on each sample nail
- If the sample has decorations at the nail tip (e.g. metallic/chrome/silver accents, drip effects), those MUST appear at the fingertip end of the result nails too
- If the sample has a gradient (e.g. pink to dark to metallic), reproduce that exact gradient direction and color transition
- The design must FULLY COVER each nail from cuticle to tip — no bare/unpainted nail should be visible
- Each finger's design should match its corresponding sample nail (left=thumb through right=pinky)

NAIL SHAPE, TIP THICKNESS & LENGTH:
- The nail shape MUST match the sample: almond, square, round, coffin, stiletto, etc.
- The nail TIP THICKNESS must match the sample exactly — if the sample nail tip tapers to a thin/sharp point, the result must also taper to a thin/sharp point. If the sample tip is wide/blunt, the result must be wide/blunt.
- The nail length MUST match the sample proportions
- If the sample nails extend past the fingertip, the result nails should extend past the fingertip too

HAND RECOGNITION:
- Detect whatever nails are visible in the hand photo, but do NOT assume all 5 fingers are always visible
- If only some fingers/nails are visible, only apply the design to those visible nails
- If no nails are clearly visible, return the original photo unchanged

COMPOSITION:
- Keep the EXACT same framing, zoom level, and composition as the original photo
- Do NOT crop or zoom in — the output must show the entire original image
- Make it look natural and realistic, like a professional nail salon photo

Return ONLY the edited image.`,
      },
    ]);

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
