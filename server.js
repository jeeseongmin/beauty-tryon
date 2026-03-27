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
        text: `Professional nail art editor. Apply nail designs from second image onto nails in first image.

SECOND IMAGE: 5 nail films in a row (left→right = thumb→pinky).
Top = cuticle, bottom = fingertip. Do NOT flip direction.

RULES:
- Detect all visible nails, identify which finger each is
- Apply matching design (1st=thumb, 2nd=index, 3rd=middle, 4th=ring, 5th=pinky)
- Match cuticle→tip orientation regardless of hand angle
- Reproduce design exactly: colors, patterns, gradients, decorations
- Match nail shape, length, tip thickness from sample
- ONLY modify nails — keep everything else unchanged
- Keep original composition, do not crop or zoom

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
