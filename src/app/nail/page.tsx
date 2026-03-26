"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { initNailEngine, processNailPhoto, destroyNailEngine } from "@/lib/nailArtEngine";
import NailPalette from "@/components/NailPalette";
import { nailDesigns, NailDesign } from "@/data/products";

export default function NailPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [capturedImage, setCapturedImage] = useState<HTMLCanvasElement | null>(null);
  const [selectedDesign, setSelectedDesign] = useState<NailDesign | null>(null);
  const [processing, setProcessing] = useState(false);
  const [engineLoaded, setEngineLoaded] = useState(false);
  const [hasResult, setHasResult] = useState(false);

  // Photo capture via camera
  const captureFromCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
      });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.playsInline = true;
      await video.play();

      // Wait for video to be ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Capture frame
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(video, 0, 0);

      // Stop camera
      stream.getTracks().forEach((t) => t.stop());

      setCapturedImage(canvas);
      setHasResult(false);
      setSelectedDesign(null);

      // Display captured photo on visible canvas
      if (canvasRef.current) {
        canvasRef.current.width = canvas.width;
        canvasRef.current.height = canvas.height;
        canvasRef.current.getContext("2d")!.drawImage(canvas, 0, 0);
      }

      // Init engine in background
      if (!engineLoaded) {
        initNailEngine().then(() => setEngineLoaded(true));
      }
    } catch (err) {
      console.error("Camera error:", err);
    }
  };

  // Photo upload from gallery
  const uploadFromGallery = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);

        setCapturedImage(canvas);
        setHasResult(false);
        setSelectedDesign(null);

        // Display on visible canvas
        if (canvasRef.current) {
          canvasRef.current.width = canvas.width;
          canvasRef.current.height = canvas.height;
          canvasRef.current.getContext("2d")!.drawImage(canvas, 0, 0);
        }

        // Init engine
        if (!engineLoaded) {
          initNailEngine().then(() => setEngineLoaded(true));
        }

        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    };
    input.click();
  };

  // Process when design is selected
  const handleDesignSelect = useCallback(
    async (design: NailDesign) => {
      if (!capturedImage || processing) return;
      setSelectedDesign(design);
      setProcessing(true);

      try {
        if (!engineLoaded) {
          await initNailEngine();
          setEngineLoaded(true);
        }

        const resultCanvas = await processNailPhoto(
          capturedImage,
          design.colors,
          design.pattern,
        );

        // Display result on visible canvas
        if (canvasRef.current) {
          canvasRef.current.width = resultCanvas.width;
          canvasRef.current.height = resultCanvas.height;
          canvasRef.current.getContext("2d")!.drawImage(resultCanvas, 0, 0);
        }
        setHasResult(true);
      } catch (err) {
        console.error("Processing error:", err);
      } finally {
        setProcessing(false);
      }
    },
    [capturedImage, processing, engineLoaded],
  );

  // Retake photo
  const retake = () => {
    setCapturedImage(null);
    setSelectedDesign(null);
    setHasResult(false);
  };

  // Screenshot
  const takeScreenshot = () => {
    if (!canvasRef.current) return;
    const link = document.createElement("a");
    link.download = `nail-tryon-${selectedDesign?.name || "preview"}.png`;
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
  };

  // Cleanup
  useEffect(() => {
    return () => {
      destroyNailEngine();
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-900/80 backdrop-blur">
        <Link href="/" className="text-sm text-gray-400 hover:text-white">
          ← 돌아가기
        </Link>
        <h1 className="text-sm font-semibold">네일 아트 체험</h1>
        <div className="w-16" />
      </header>

      {/* Main content area */}
      <div className="flex-1 relative flex items-center justify-center bg-black">
        {/* Landing: no photo captured yet */}
        {!capturedImage && (
          <div className="text-center p-8">
            <div className="text-6xl mb-6">💅</div>
            <h2 className="text-xl font-bold mb-2">네일 아트 체험</h2>
            <p className="text-gray-400 text-sm mb-8">
              손등 사진을 찍거나 갤러리에서 선택하세요.
              <br />
              AI가 손톱을 찾아 디자인을 입혀드립니다.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={captureFromCamera}
                className="px-8 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-full font-medium transition-colors"
              >
                📷 사진 촬영
              </button>
              <button
                onClick={uploadFromGallery}
                className="px-8 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-full font-medium transition-colors"
              >
                🖼️ 갤러리에서 선택
              </button>
            </div>
          </div>
        )}

        {/* Canvas: shows captured photo or processed result */}
        <canvas
          ref={canvasRef}
          className={`max-w-full max-h-full object-contain ${capturedImage ? "block" : "hidden"}`}
        />

        {/* Processing overlay */}
        {processing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="text-center">
              <div className="animate-spin w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-gray-300 text-sm">네일 디자인 적용 중...</p>
            </div>
          </div>
        )}

        {/* Design indicator */}
        {capturedImage && selectedDesign && hasResult && (
          <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1.5 backdrop-blur">
            <span
              className="w-4 h-4 rounded-full border border-white/50"
              style={{ backgroundColor: selectedDesign.colors[0] }}
            />
            <span className="text-xs">{selectedDesign.name}</span>
          </div>
        )}

        {/* Retake + save buttons */}
        {capturedImage && (
          <div className="absolute top-4 right-4 flex gap-2">
            <button
              onClick={retake}
              className="px-4 py-2 bg-white/20 backdrop-blur rounded-full text-xs hover:bg-white/30 transition-colors"
            >
              다시 찍기
            </button>
            {hasResult && (
              <button
                onClick={takeScreenshot}
                className="w-10 h-10 bg-white/20 backdrop-blur rounded-full flex items-center justify-center hover:bg-white/30 transition-colors"
                title="저장"
              >
                📸
              </button>
            )}
          </div>
        )}

        {/* Guide: photo captured but no design selected */}
        {capturedImage && !selectedDesign && !processing && (
          <div className="absolute bottom-4 left-0 right-0 text-center">
            <p className="text-gray-400 text-sm bg-black/40 inline-block px-4 py-2 rounded-full backdrop-blur">
              아래에서 네일 디자인을 선택하세요
            </p>
          </div>
        )}
      </div>

      {/* Nail palette: shown when photo is captured */}
      {capturedImage && (
        <div className="bg-gray-900 px-4 py-4 border-t border-gray-800">
          <NailPalette
            designs={nailDesigns}
            selectedId={selectedDesign?.id ?? null}
            onSelect={handleDesignSelect}
          />
        </div>
      )}
    </div>
  );
}
