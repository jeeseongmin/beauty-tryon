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

NAIL DETECTION:
- Automatically find all visible fingernails in the hand photo
- ONLY modify the nail areas — keep skin, background, and everything else EXACTLY unchanged
- If only some fingers are visible, only apply to those visible nails
- If no nails are clearly visible, return the original photo unchanged

NAIL FILM SAMPLE ORIENTATION (second image):
- The sample shows 5 nail films laid out VERTICALLY in a row
- Order from LEFT to RIGHT: THUMB, INDEX, MIDDLE, RING, PINKY
- TOP end = CUTICLE side (wider/rounder, attaches near knuckle)
- BOTTOM end = FINGERTIP side (narrower/pointed, the free edge)
- When applying: TOP of sample → cuticle area, BOTTOM of sample → fingertip
- DO NOT FLIP OR REVERSE the design direction
- Apply each film to its CORRECT finger (thumb design → thumb, etc.)

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
