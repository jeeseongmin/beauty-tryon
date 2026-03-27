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
      model: "gemini-2.0-flash-exp",
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

The first image is a photo of a hand/nails. The second image is a nail art design sample.

Apply the nail art design from the second image onto the nails in the first image.
- Keep the hand, skin, and background exactly the same
- Only change the nails to match the design pattern/color from the second image
- Make it look natural and realistic, as if the person actually has that nail art applied
- Preserve the nail shape and perspective from the original photo
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
