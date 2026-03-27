"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";

const SAMPLES = [
  { id: 1, sample: "/nail-designs/sample1.jpeg", name: "기본" },
  { id: 2, sample: "/nail-designs/sample2.jpeg", name: "디자인 2" },
  { id: 3, sample: "/nail-designs/sample3.jpeg", name: "디자인 3" },
  { id: 4, sample: "/nail-designs/sample4.jpeg", name: "디자인 4" },
  { id: 5, sample: "/nail-designs/sample5.jpeg", name: "디자인 5" },
];

export default function NailPage() {
  const [uploadedPhoto, setUploadedPhoto] = useState<string | null>(null); // base64 data URL
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [popupSrc, setPopupSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload photo
  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setUploadedPhoto(reader.result as string);
      setResultImage(null);
      setSelectedId(null);
      setError(null);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // Generate preview via Gemini
  const generatePreview = async () => {
    if (!uploadedPhoto || !selectedId) return;

    setProcessing(true);
    setError(null);

    try {
      const res = await fetch("/api/nail-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handPhoto: uploadedPhoto,
          sampleId: selectedId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "처리 중 오류가 발생했습니다");
        return;
      }

      setResultImage(data.image);
    } catch (err) {
      setError("서버 연결에 실패했습니다");
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  const retake = () => {
    setUploadedPhoto(null);
    setResultImage(null);
    setSelectedId(null);
    setError(null);
  };

  // Screenshot
  const takeScreenshot = () => {
    if (!resultImage) return;
    const link = document.createElement("a");
    link.download = `nail-design-${selectedId}.png`;
    link.href = resultImage;
    link.click();
  };

  // Display image: result if available, otherwise uploaded photo
  const displayImage = resultImage || uploadedPhoto;

  return (
    <div className="flex-1 flex flex-col bg-gray-950 text-white">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChange}
      />

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-900/80 backdrop-blur">
        {uploadedPhoto ? (
          <button onClick={retake} className="text-sm text-gray-400 hover:text-white">
            ← 다시 찍기
          </button>
        ) : (
          <Link href="/" className="text-sm text-gray-400 hover:text-white">
            ← 돌아가기
          </Link>
        )}
        <h1 className="text-sm font-semibold">💅 네일 아트 체험</h1>
        <div className="w-16 flex justify-end">
          {resultImage && (
            <button onClick={takeScreenshot} className="text-lg" title="저장">
              📸
            </button>
          )}
        </div>
      </header>

      {/* Main area */}
      <div className="flex-1 min-h-0 relative flex items-center justify-center bg-black overflow-hidden">

        {/* Landing */}
        {!uploadedPhoto && (
          <div className="text-center p-8">
            <div className="text-6xl mb-6">💅</div>
            <h2 className="text-xl font-bold mb-2">네일 아트 체험</h2>
            <p className="text-gray-400 text-sm mb-8">
              손등 사진을 올려주세요.
              <br />
              AI가 선택한 네일 디자인을 입혀드립니다.
            </p>
            <button
              onClick={handleUpload}
              className="px-8 py-4 bg-purple-500 hover:bg-purple-600 text-white rounded-full font-semibold transition-colors"
            >
              📷 사진 업로드
            </button>
          </div>
        )}

        {/* Display image */}
        {displayImage && (
          <div className="relative w-full h-full flex items-center justify-center p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayImage}
              alt="네일 아트 결과"
              className="max-w-full max-h-full object-contain"
            />

            {/* Result badge */}
            {resultImage && (
              <div className="absolute top-4 left-4 bg-purple-500/80 rounded-full px-3 py-1 backdrop-blur">
                <span className="text-xs font-medium">AI 적용 완료</span>
              </div>
            )}
          </div>
        )}

        {/* Processing spinner */}
        {processing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="text-center">
              <div className="animate-spin w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-6" />
              <p className="text-gray-300 text-sm mb-1">AI가 네일 디자인을 적용하고 있습니다...</p>
              <p className="text-gray-500 text-xs">약 5~10초 소요</p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="absolute bottom-32 left-4 right-4 text-center">
            <p className="text-red-400 text-sm bg-red-900/30 inline-block px-4 py-2 rounded-full">
              {error}
            </p>
          </div>
        )}
      </div>

      {/* Bottom panel — sample palette + preview button (not fixed, part of flow) */}
      {uploadedPhoto && (
        <div className="bg-gray-900 border-t border-gray-800 flex-shrink-0">
          <div className="px-4 pt-3 pb-2">
            <p className="text-[10px] text-gray-500 mb-2">네일 디자인 선택 (더블클릭으로 확대)</p>
            <div className="flex gap-3 overflow-x-auto scrollbar-hide">
              {SAMPLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  onDoubleClick={() => setPopupSrc(s.sample)}
                  className={`flex-shrink-0 transition-all ${
                    selectedId === s.id
                      ? "ring-2 ring-purple-500 scale-105"
                      : "opacity-70 hover:opacity-100"
                  }`}
                >
                  <Image
                    src={s.sample}
                    alt={s.name}
                    width={64}
                    height={64}
                    className="w-16 h-16 object-cover rounded-lg"
                  />
                  <span className="text-[10px] text-gray-400 mt-1 block text-center">
                    {s.name}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Preview button */}
          <div className="px-4 pb-3 pt-1">
            <button
              onClick={generatePreview}
              disabled={!selectedId || processing}
              className={`w-full py-3 rounded-full font-semibold text-sm transition-colors ${
                selectedId && !processing
                  ? "bg-purple-500 hover:bg-purple-600 text-white"
                  : "bg-gray-700 text-gray-500 cursor-not-allowed"
              }`}
            >
              {processing ? "처리 중..." : selectedId ? "✨ 미리보기 생성" : "디자인을 선택하세요"}
            </button>
          </div>
        </div>
      )}

      {/* Popup — double click sample */}
      {popupSrc && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur flex items-center justify-center p-6"
          onClick={() => setPopupSrc(null)}
        >
          <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <Image
              src={popupSrc}
              alt="네일 디자인 확대"
              width={1200}
              height={900}
              className="w-full h-auto rounded-xl"
            />
            <button
              onClick={() => setPopupSrc(null)}
              className="absolute top-3 right-3 w-8 h-8 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-black/80"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
