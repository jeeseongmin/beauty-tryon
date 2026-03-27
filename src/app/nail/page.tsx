"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  initNailEngine,
  processNailPhoto,
  destroyNailEngine,
} from "@/lib/nailArtEngine";
import NailPalette from "@/components/NailPalette";
import { nailDesigns, NailDesign } from "@/data/products";

export default function NailPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [capturedImage, setCapturedImage] = useState<HTMLCanvasElement | null>(
    null
  );
  const [selectedDesign, setSelectedDesign] = useState<NailDesign | null>(null);
  const [processing, setProcessing] = useState(false);
  const [engineLoaded, setEngineLoaded] = useState(false);
  const [hasResult, setHasResult] = useState(false);

  // Show image on visible canvas
  const showOnCanvas = (source: HTMLCanvasElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext("2d")!.drawImage(source, 0, 0);
  };

  // Capture from camera (rear)
  const captureFromCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
      });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.playsInline = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 500));

      const c = document.createElement("canvas");
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext("2d")!.drawImage(video, 0, 0);
      stream.getTracks().forEach((t) => t.stop());

      setCapturedImage(c);
      setHasResult(false);
      setSelectedDesign(null);
      showOnCanvas(c);

      if (!engineLoaded) {
        initNailEngine().then(() => setEngineLoaded(true));
      }
    } catch (err) {
      console.error("Camera error:", err);
    }
  };

  // Upload from gallery
  const uploadFromGallery = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d")!.drawImage(img, 0, 0);

        setCapturedImage(c);
        setHasResult(false);
        setSelectedDesign(null);
        showOnCanvas(c);

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

        const result = await processNailPhoto(
          capturedImage,
          design.colors,
          design.pattern
        );

        showOnCanvas(result);
        setHasResult(true);
      } catch (err) {
        console.error("Processing error:", err);
      } finally {
        setProcessing(false);
      }
    },
    [capturedImage, processing, engineLoaded]
  );

  // Retake
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
        {capturedImage ? (
          <button
            onClick={retake}
            className="text-sm text-gray-400 hover:text-white"
          >
            ← 다시 찍기
          </button>
        ) : (
          <Link href="/" className="text-sm text-gray-400 hover:text-white">
            ← 돌아가기
          </Link>
        )}
        <h1 className="text-sm font-semibold">💅 네일 아트 체험</h1>
        <div className="w-16 flex justify-end">
          {hasResult && (
            <button
              onClick={takeScreenshot}
              className="text-lg"
              title="저장"
            >
              📸
            </button>
          )}
        </div>
      </header>

      {/* Main */}
      <div
        className={`flex-1 relative flex items-center justify-center bg-black ${capturedImage ? "pb-20" : ""}`}
      >
        {/* Landing */}
        {!capturedImage && (
          <div className="text-center p-8">
            <div className="text-6xl mb-6">💅</div>
            <h2 className="text-xl font-bold mb-2">네일 아트 체험</h2>
            <p className="text-gray-400 text-sm mb-8">
              손등 사진을 찍거나 갤러리에서 선택하세요.
              <br />
              AI가 손톱을 찾아 디자인을 입혀드립니다.
            </p>
            <div className="flex flex-col gap-3 max-w-xs mx-auto">
              <button
                onClick={captureFromCamera}
                className="w-full px-8 py-4 bg-purple-500 hover:bg-purple-600 text-white rounded-full font-semibold transition-colors"
              >
                📷 사진 촬영
              </button>
              <button
                onClick={uploadFromGallery}
                className="w-full px-8 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-full font-medium transition-colors"
              >
                🖼️ 갤러리에서 선택
              </button>
            </div>
          </div>
        )}

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          className={`max-w-full max-h-full object-contain ${capturedImage ? "block" : "hidden"}`}
        />

        {/* Processing spinner */}
        {processing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="text-center">
              <div className="animate-spin w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-gray-300 text-sm">네일 디자인 적용 중...</p>
            </div>
          </div>
        )}

        {/* Design indicator */}
        {hasResult && selectedDesign && (
          <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1.5 backdrop-blur">
            <span
              className="w-4 h-4 rounded-full border border-white/50"
              style={{ backgroundColor: selectedDesign.colors[0] }}
            />
            <span className="text-xs">{selectedDesign.name}</span>
          </div>
        )}

        {/* Guide */}
        {capturedImage && !selectedDesign && !processing && (
          <div className="absolute bottom-24 left-0 right-0 text-center">
            <p className="text-gray-400 text-sm bg-black/40 inline-block px-4 py-2 rounded-full backdrop-blur">
              아래에서 네일 디자인을 선택하세요
            </p>
          </div>
        )}
      </div>

      {/* Nail palette — fixed at bottom */}
      {capturedImage && (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-900 px-4 py-4 border-t border-gray-800 z-50">
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
