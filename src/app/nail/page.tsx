"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useCamera } from "@/lib/useCamera";
import { initNailEngine, renderNailArt, destroyNailEngine } from "@/lib/nailArtEngine";
import NailPalette from "@/components/NailPalette";
import { nailDesigns, NailDesign } from "@/data/products";

export default function NailPage() {
  const { videoRef, isReady, error, start, stop } = useCamera();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const [selectedDesign, setSelectedDesign] = useState<NailDesign | null>(null);
  const [loading, setLoading] = useState(false);
  const [engineReady, setEngineReady] = useState(false);

  const startAR = useCallback(async () => {
    setLoading(true);
    try {
      await start();
      await initNailEngine();
      setEngineReady(true);
    } catch (err) {
      console.error("Failed to init nail AR:", err);
    } finally {
      setLoading(false);
    }
  }, [start]);

  // Render loop
  useEffect(() => {
    if (!isReady || !engineReady || !canvasRef.current || !videoRef.current)
      return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const video = videoRef.current;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    let running = true;
    const render = () => {
      if (!running) return;

      if (selectedDesign) {
        renderNailArt(ctx, video, selectedDesign.colors, selectedDesign.pattern);
      } else {
        // Just mirror the video
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
        ctx.restore();
      }

      animFrameRef.current = requestAnimationFrame(render);
    };
    render();

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [isReady, engineReady, selectedDesign, videoRef]);

  // Cleanup
  useEffect(() => {
    return () => {
      stop();
      destroyNailEngine();
    };
  }, [stop]);

  // Screenshot
  const takeScreenshot = () => {
    if (!canvasRef.current) return;
    const link = document.createElement("a");
    link.download = `nail-tryon-${selectedDesign?.name || "preview"}.png`;
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-900/80 backdrop-blur">
        <Link href="/" className="text-sm text-gray-400 hover:text-white">
          ← 돌아가기
        </Link>
        <h1 className="text-sm font-semibold">💅 네일 아트 체험</h1>
        <div className="w-16" />
      </header>

      {/* Camera / Canvas */}
      <div className="flex-1 relative flex items-center justify-center bg-black">
        {!isReady && !loading && (
          <div className="text-center p-8">
            <div className="text-6xl mb-6">💅</div>
            <h2 className="text-xl font-bold mb-2">네일 아트 시뮬레이션</h2>
            <p className="text-gray-400 text-sm mb-6">
              카메라에 손을 비추면 네일 아트 필름이
              <br />
              실시간으로 적용됩니다
            </p>
            <button
              onClick={startAR}
              className="px-8 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-full font-medium transition-colors"
            >
              카메라 시작하기
            </button>
            {error && (
              <p className="mt-4 text-red-400 text-sm">{error}</p>
            )}
          </div>
        )}

        {loading && (
          <div className="text-center p-8">
            <div className="animate-spin w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-400 text-sm">AI 엔진을 불러오는 중...</p>
          </div>
        )}

        <video
          ref={videoRef}
          className="hidden"
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          className={`max-w-full max-h-full object-contain ${
            isReady ? "block" : "hidden"
          }`}
        />

        {/* Selected design indicator */}
        {isReady && selectedDesign && (
          <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1.5 backdrop-blur">
            <span
              className="w-4 h-4 rounded-full border border-white/50"
              style={{ backgroundColor: selectedDesign.colors[0] }}
            />
            <span className="text-xs">{selectedDesign.name}</span>
          </div>
        )}

        {/* Guide text */}
        {isReady && !selectedDesign && (
          <div className="absolute bottom-20 left-0 right-0 text-center">
            <p className="text-gray-400 text-sm bg-black/40 inline-block px-4 py-2 rounded-full backdrop-blur">
              아래에서 네일 디자인을 선택하세요
            </p>
          </div>
        )}

        {/* Screenshot button */}
        {isReady && selectedDesign && (
          <button
            onClick={takeScreenshot}
            className="absolute bottom-4 right-4 w-12 h-12 bg-white/20 backdrop-blur rounded-full flex items-center justify-center hover:bg-white/30 transition-colors"
            title="스크린샷 저장"
          >
            📸
          </button>
        )}
      </div>

      {/* Nail design palette */}
      {isReady && (
        <div className="bg-gray-900 px-4 py-4 border-t border-gray-800">
          <NailPalette
            designs={nailDesigns}
            selectedId={selectedDesign?.id ?? null}
            onSelect={setSelectedDesign}
          />
        </div>
      )}
    </div>
  );
}
