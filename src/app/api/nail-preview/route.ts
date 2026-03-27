import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  try {
    const { handPhoto, sampleId } = await req.json();

    if (!handPhoto || !sampleId) {
      return NextResponse.json({ error: "Missing handPhoto or sampleId" }, { status: 400 });
    }

    // Read sample design image from public folder
    const samplePath = join(process.cwd(), "public", "nail-designs", `sample${sampleId}.jpeg`);
    const sampleBuffer = readFileSync(samplePath);
    const sampleBase64 = sampleBuffer.toString("base64");

    // Strip data URL prefix from hand photo
    const handBase64 = handPhoto.replace(/^data:image\/\w+;base64,/, "");

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
          mimeType: "image/jpeg",
          data: sampleBase64,
        },
      },
      {
        text: `You are a professional nail art editor.

The first image is a photo of a hand/nails. The second image shows nail art film/tip samples laid out in a row.

IMPORTANT about the second image (nail film samples):
- The second image shows 5 nail films laid out in a row, ordered from LEFT to RIGHT: THUMB, INDEX, MIDDLE, RING, PINKY
- The LEFTMOST (largest/widest) film is for the THUMB, the RIGHTMOST (smallest/narrowest) is for the PINKY
- The WIDER/ROUNDER end of each nail film is the cuticle side (attaches near the knuckle)
- The NARROWER/POINTED end is the fingertip side
- Apply each film to the CORRECT finger: thumb design → thumb nail, index design → index nail, etc.
- Each finger's design may have slightly different patterns or sizes — match them accurately per finger

Apply the nail art design from the second image onto the nails in the first image.
- Keep the hand, skin, and background EXACTLY the same — do not alter anything except the nails
- Only change the nails to match the design pattern/color/art from the second image
- NAIL SHAPE: The nail shape in the result MUST match the nail film shape from the second image. If the sample nails are almond-shaped (tapered/pointed tips), make the result nails almond-shaped too. If they are square, make them square. If they are round, make them round. Copy the exact nail shape from the sample.
- NAIL LENGTH: Match the nail length from the sample image as closely as possible
- Make it look natural and realistic, as if the nail film is actually applied on the hand
- IMPORTANT: Keep the EXACT same framing, zoom level, and composition as the original photo. Do NOT crop or zoom in. The output must show the entire original image.
- The result should look like a professional nail salon photo

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
