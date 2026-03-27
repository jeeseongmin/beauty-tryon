const express = require("express");
const cors = require("cors");
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require("fs");
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

        // Save result to server
        const resultDir = join(__dirname, "public", "nail-designs", "result");
        if (!existsSync(resultDir)) mkdirSync(resultDir, { recursive: true });
        const filename = `sample${sampleId}_${Date.now()}.jpeg`;
        writeFileSync(join(resultDir, filename), Buffer.from(imageData.data, "base64"));
        console.log(`[nail-preview] Saved to result/${filename}`);

        return res.json({
          image: `data:${imageData.mimeType};base64,${imageData.data}`,
          savedPath: `/beauty/nail-designs/result/${filename}`,
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

// API: Custom nail color
app.post("/beauty/api/nail-custom", async (req, res) => {
  try {
    const { handPhoto, color, finish } = req.body;

    if (!handPhoto || !color || !finish) {
      return res.status(400).json({ error: "Missing handPhoto, color, or finish" });
    }

    const handBase64 = handPhoto.replace(/^data:image\/\w+;base64,/, "");

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-image",
      generationConfig: {
        responseModalities: ["image", "text"],
      },
    });

    console.log(`[nail-custom] Starting Gemini request: color=${color}, finish=${finish}...`);
    const startTime = Date.now();
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: handBase64,
        },
      },
      {
        text: `Professional nail art editor. Apply solid nail color to all visible nails in the photo.

COLOR: ${color}
FINISH: ${finish}

RULES:
- Detect all visible nails in the hand photo
- Apply the specified solid color with the specified finish to every nail
- ${finish === "matte" ? "Matte finish: no shine, no reflection, velvety flat surface" : ""}${finish === "glossy" ? "Glossy finish: high shine, wet-look, mirror-like reflection" : ""}${finish === "shimmer" ? "Shimmer/pearl finish: subtle sparkle, pearlescent sheen" : ""}${finish === "glitter" ? "Glitter finish: visible glitter particles throughout the color" : ""}${finish === "chrome" ? "Chrome/metallic finish: mirror-like metallic reflection, liquid metal look" : ""}${finish === "syrup" ? "Syrup finish: VERY translucent and sheer — the natural nail and skin underneath must be clearly visible through the color. Think tinted glass or colored cellophane, not opaque paint. The color should be a thin transparent tint over the nail, glossy and jelly-like." : ""}${finish === "magnet" ? "Cat-eye/magnet finish: magnetic swirl pattern with a bright light streak across the nail, 3D depth effect" : ""}
- ONLY modify nails — keep everything else unchanged
- Keep original composition, do not crop or zoom
- Make it look natural and realistic

Return ONLY the edited image.`,
      },
    ]);

    console.log(`[nail-custom] Gemini responded in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    const response = result.response;
    const parts = response.candidates?.[0]?.content?.parts;

    if (!parts) {
      return res.status(500).json({ error: "No response from Gemini" });
    }

    for (const part of parts) {
      if (part.inlineData) {
        const imageData = part.inlineData;
        const imageBase64 = imageData.data;

        // Save to server
        const customDir = join(__dirname, "public", "nail-designs", "custom");
        if (!existsSync(customDir)) mkdirSync(customDir, { recursive: true });
        const filename = `${color.replace("#", "")}_${finish}_${Date.now()}.jpeg`;
        const filePath = join(customDir, filename);
        writeFileSync(filePath, Buffer.from(imageBase64, "base64"));
        console.log(`[nail-custom] Saved to ${filePath}`);

        return res.json({
          image: `data:${imageData.mimeType};base64,${imageBase64}`,
          savedPath: `/beauty/nail-designs/custom/${filename}`,
        });
      }
    }

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
