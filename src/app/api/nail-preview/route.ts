import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  try {
    const { handPhoto, maskImage, sampleId } = await req.json();

    if (!handPhoto || !maskImage || !sampleId) {
      return NextResponse.json({ error: "Missing handPhoto, maskImage, or sampleId" }, { status: 400 });
    }

    // Read sample design image from public folder
    const samplePath = join(process.cwd(), "public", "nail-designs", `sample${sampleId}.jpeg`);
    const sampleBuffer = readFileSync(samplePath);
    const sampleBase64 = sampleBuffer.toString("base64");

    // Strip data URL prefix from hand photo and mask
    const handBase64 = handPhoto.replace(/^data:image\/\w+;base64,/, "");
    const maskBase64 = maskImage.replace(/^data:image\/\w+;base64,/, "");

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-image",
      generationConfig: {
        responseModalities: ["image", "text"],
      } as any,
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

IMPORTANT about the third image (nail film samples):
- The third image shows 5 nail films laid out in a row, ordered from LEFT to RIGHT: THUMB, INDEX, MIDDLE, RING, PINKY
- The LEFTMOST (largest/widest) film is for the THUMB, the RIGHTMOST (smallest/narrowest) is for the PINKY
- The WIDER/ROUNDER end of each nail film is the cuticle side (attaches near the knuckle)
- The NARROWER/POINTED end is the fingertip side
- Apply each film to the CORRECT finger: thumb design → thumb nail, index design → index nail, etc.
- Each finger's design may have slightly different patterns or sizes — match them accurately per finger

Apply the nail art design from the third image onto ONLY the white-masked nail areas in the first image.
- ONLY modify pixels that fall within the WHITE mask regions
- Everything outside the white mask must remain pixel-perfect identical to the original photo

CRITICAL — REPRODUCE THE DESIGN EXACTLY:
- Copy EVERY detail from the sample: colors, gradients, patterns, decorations, glitter, metallic parts, 3D elements, jewels, lines, dots — everything visible on each sample nail
- If the sample has decorations at the nail tip (e.g. metallic/chrome/silver accents, drip effects), those MUST appear at the fingertip end of the result nails too
- If the sample has a gradient (e.g. pink to dark to metallic), reproduce that exact gradient direction and color transition
- The design must FULLY COVER each nail from cuticle to tip — no bare/unpainted nail should be visible
- Each finger's design should match its corresponding sample nail (left=thumb through right=pinky)

NAIL SHAPE & LENGTH:
- The nail shape MUST match the sample: almond, square, round, coffin, stiletto, etc.
- The nail length MUST match the sample proportions
- If the sample nails extend past the fingertip, the result nails should extend past the fingertip too

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
      return NextResponse.json({ error: "No response from Gemini" }, { status: 500 });
    }

    // Find the image part in the response
    for (const part of parts) {
      if ((part as any).inlineData) {
        const imageData = (part as any).inlineData;
        return NextResponse.json({
          image: `data:${imageData.mimeType};base64,${imageData.data}`,
        });
      }
    }

    // If no image part, return text error
    const textPart = parts.find((p: any) => p.text);
    return NextResponse.json(
      { error: (textPart as any)?.text || "Gemini did not return an image" },
      { status: 500 }
    );
  } catch (error: any) {
    console.error("Gemini API error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
