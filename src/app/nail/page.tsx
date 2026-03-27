"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { initNailEngine, processNailPhoto, destroyNailEngine } from "@/lib/nailArtEngine";
import {
  initRealtimeNailEngine,
  renderRealtimeNailArt,
  destroyRealtimeNailEngine,
} from "@/lib/nailArtRealtimeEngine";
import { useCamera } from "@/lib/useCamera";
import NailPalette from "@/components/NailPalette";
import { nailDesigns, NailDesign } from "@/data/products";

type Mode = "landing" | "realtime" | "photo";

export default function NailPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Mode
  const [mode, setMode] = useState<Mode>("landing");

  // Shared
  const [selectedDesign, setSelectedDesign] = useState<NailDesign | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [loading, setLoading] = useState(false);

  // Real-time mode
  const { videoRef, start, stop } = useCamera({ facingMode: "user", width: 1280, height: 960 });
  const [realtimeReady, setRealtimeReady] = useState(false);

  // Photo mode
  const [capturedImage, setCapturedImage] = useState<HTMLCanvasElement | null>(null);
  const [processing, setProcessing] = useState(false);
  const [photoEngineLoaded, setPhotoEngineLoaded] = useState(false);

  // ── Real-time ──────────────────────────────────────────────────────────────

  const startRealtime = async () => {
    setMode("realtime");
    setLoading(true);
    await start();
    await initRealtimeNailEngine();
    setRealtimeReady(true);
    setLoading(false);
  };

  // Real-time render loop
  useEffect(() => {
    if (mode !== "realtime" || !realtimeReady || !canvasRef.current || !videoRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const video = videoRef.current;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    let running = true;
    const render = () => {
      if (!running) return;
      // Re-sync dimensions when video metadata arrives
      if (video.videoWidth && canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      if (selectedDesign) {
        renderRealtimeNailArt(ctx, video, selectedDesign.colors, selectedDesign.pattern);
      } else {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
        ctx.restore();
      }
      requestAnimationFrame(render);
    };
    render();

    return () => {
      running = false;
    };
  }, [mode, realtimeReady, selectedDesign, videoRef]);

  // ── Photo mode ─────────────────────────────────────────────────────────────

  const showPhotoOnCanvas = (photoCanvas: HTMLCanvasElement) => {
    if (canvasRef.current) {
      canvasRef.current.width = photoCanvas.width;
      canvasRef.current.height = photoCanvas.height;
      canvasRef.current.getContext("2d")!.drawImage(photoCanvas, 0, 0);
    }
  };

  const captureFromCamera = async () => {
    setMode("photo");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
      });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.playsInline = true;
      await video.play();

      await new Promise((resolve) => setTimeout(resolve, 500));

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);

      stream.getTracks().forEach((t) => t.stop());

      setCapturedImage(canvas);
      setHasResult(false);
      setSelectedDesign(null);
      showPhotoOnCanvas(canvas);

      if (!photoEngineLoaded) {
        initNailEngine().then(() => setPhotoEngineLoaded(true));
      }
    } catch (err) {
      console.error("Camera error:", err);
      setMode("landing");
    }
  };

  const uploadFromGallery = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setMode("photo");
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d")!.drawImage(img, 0, 0);

        setCapturedImage(canvas);
        setHasResult(false);
        setSelectedDesign(null);
        showPhotoOnCanvas(canvas);

        if (!photoEngineLoaded) {
          initNailEngine().then(() => setPhotoEngineLoaded(true));
        }

        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    };
    input.click();
  };

  const handleDesignSelect = useCallback(
    async (design: NailDesign) => {
      if (mode === "realtime") {
        // Just update selectedDesign — render loop picks it up
        setSelectedDesign(design);
        return;
      }

      // Photo mode
      if (!capturedImage || processing) return;
      setSelectedDesign(design);
      setProcessing(true);

      try {
        if (!photoEngineLoaded) {
          await initNailEngine();
          setPhotoEngineLoaded(true);
        }

        const resultCanvas = await processNailPhoto(capturedImage, design.colors, design.pattern);

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
    [mode, capturedImage, processing, photoEngineLoaded],
  );

  // ── Navigation ─────────────────────────────────────────────────────────────

  const goBack = () => {
    if (mode === "realtime") {
      stop();
      destroyRealtimeNailEngine();
      setRealtimeReady(false);
    }
    if (mode === "photo") {
      destroyNailEngine();
      setPhotoEngineLoaded(false);
    }
    setCapturedImage(null);
    setSelectedDesign(null);
    setHasResult(false);
    setMode("landing");
  };

  // ── Screenshot ─────────────────────────────────────────────────────────────

  const takeScreenshot = () => {
    if (!canvasRef.current) return;
    const link = document.createElement("a");
    link.download = `nail-tryon-${selectedDesign?.name || "preview"}.png`;
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
  };

  // ── Cleanup on unmount ─────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stop();
      destroyRealtimeNailEngine();
      destroyNailEngine();
    };
  }, [stop]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const showPalette =
    (mode === "realtime" && realtimeReady) || (mode === "photo" && capturedImage !== null);

  return (
    <div className="flex-1 flex flex-col bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-900/80 backdrop-blur">
        {mode === "landing" ? (
          <Link href="/" className="text-sm text-gray-400 hover:text-white">
            ← 돌아가기
          </Link>
        ) : (
          <button
            onClick={goBack}
            className="text-sm text-gray-400 hover:text-white"
          >
            ← 모드 선택
          </button>
        )}
        <h1 className="text-sm font-semibold">💅 네일 아트 체험</h1>
        {mode !== "landing" ? (
          <span className="text-xs text-gray-500">
            {mode === "realtime" ? "실시간" : "사진"}
          </span>
        ) : (
          <div className="w-16" />
        )}
      </header>

      {/* Main content */}
      <div className="flex-1 relative flex items-center justify-center bg-black">
        {/* Landing */}
        {mode === "landing" && (
          <div className="text-center p-8">
            <div className="text-6xl mb-6">💅</div>
            <h2 className="text-xl font-bold mb-2">네일 아트 체험</h2>
            <p className="text-gray-400 text-sm mb-8">
              실시간으로 체험하거나, 사진으로 고품질 결과를 확인하세요.
            </p>
            <div className="flex flex-col gap-3 max-w-xs mx-auto">
              <button
                onClick={startRealtime}
                className="w-full px-8 py-4 bg-purple-500 hover:bg-purple-600 text-white rounded-full font-semibold text-base transition-colors"
              >
                🎥 실시간 체험
              </button>
              <div className="flex gap-3">
                <button
                  onClick={captureFromCamera}
                  className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-full font-medium transition-colors"
                >
                  📸 사진 촬영
                </button>
                <button
                  onClick={uploadFromGallery}
                  className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-full font-medium transition-colors"
                >
                  🖼️ 갤러리
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Real-time mode */}
        {mode === "realtime" && (
          <>
            <video ref={videoRef} className="hidden" playsInline muted />
            <canvas
              ref={canvasRef}
              className="max-w-full max-h-full object-contain"
            />
            {/* Loading spinner */}
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="text-center">
                  <div className="animate-spin w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-4" />
                  <p className="text-gray-300 text-sm">카메라 초기화 중...</p>
                </div>
              </div>
            )}
            {/* Screenshot button */}
            {realtimeReady && selectedDesign && (
              <div className="absolute top-4 right-4 flex gap-2">
                <button
                  onClick={takeScreenshot}
                  className="w-10 h-10 bg-white/20 backdrop-blur rounded-full flex items-center justify-center hover:bg-white/30 transition-colors"
                  title="저장"
                >
                  📸
                </button>
              </div>
            )}
            {/* Design indicator */}
            {realtimeReady && selectedDesign && (
              <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1.5 backdrop-blur">
                <span
                  className="w-4 h-4 rounded-full border border-white/50"
                  style={{ backgroundColor: selectedDesign.colors[0] }}
                />
                <span className="text-xs">{selectedDesign.name}</span>
              </div>
            )}
            {/* Guide */}
            {realtimeReady && !selectedDesign && (
              <div className="absolute bottom-4 left-0 right-0 text-center">
                <p className="text-gray-400 text-sm bg-black/40 inline-block px-4 py-2 rounded-full backdrop-blur">
                  아래에서 네일 디자인을 선택하세요
                </p>
              </div>
            )}
          </>
        )}

        {/* Photo mode */}
        {mode === "photo" && (
          <>
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
            {/* Top-right controls */}
            {capturedImage && (
              <div className="absolute top-4 right-4 flex gap-2">
                <button
                  onClick={() => {
                    setCapturedImage(null);
                    setSelectedDesign(null);
                    setHasResult(false);
                  }}
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
            {/* Guide */}
            {capturedImage && !selectedDesign && !processing && (
              <div className="absolute bottom-4 left-0 right-0 text-center">
                <p className="text-gray-400 text-sm bg-black/40 inline-block px-4 py-2 rounded-full backdrop-blur">
                  아래에서 네일 디자인을 선택하세요
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Nail palette */}
      {showPalette && (
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
