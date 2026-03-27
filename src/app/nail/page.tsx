"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import Image from "next/image";

const SAMPLES = [
  { id: 1, sample: "/nail-designs/sample1.jpeg", after: "/nail-designs/after1.jpeg", name: "기본" },
  { id: 2, sample: "/nail-designs/sample2.jpeg", after: "/nail-designs/after2.jpeg", name: "디자인 2" },
  { id: 3, sample: "/nail-designs/sample3.jpeg", after: "/nail-designs/after3.jpeg", name: "디자인 3" },
  { id: 4, sample: "/nail-designs/sample4.jpeg", after: "/nail-designs/after4.jpeg", name: "디자인 4" },
  { id: 5, sample: "/nail-designs/sample5.jpeg", after: "/nail-designs/after5.jpeg", name: "디자인 5" },
];

export default function NailPage() {
  const [uploaded, setUploaded] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedId, setSelectedId] = useState<number>(1);
  const [popupSrc, setPopupSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = SAMPLES.find((s) => s.id === selectedId)!;

  // File upload → fake analysis → show after1
  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Start "analyzing" animation
    setAnalyzing(true);
    setSelectedId(1);

    // Simulate AI processing time
    setTimeout(() => {
      setAnalyzing(false);
      setUploaded(true);
    }, 2000);

    // Reset input so same file can be re-uploaded
    e.target.value = "";
  };

  const retake = () => {
    setUploaded(false);
    setSelectedId(1);
  };

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
        {uploaded ? (
          <button onClick={retake} className="text-sm text-gray-400 hover:text-white">
            ← 다시 찍기
          </button>
        ) : (
          <Link href="/" className="text-sm text-gray-400 hover:text-white">
            ← 돌아가기
          </Link>
        )}
        <h1 className="text-sm font-semibold">💅 네일 아트 체험</h1>
        <div className="w-16" />
      </header>

      {/* Main area */}
      <div className={`flex-1 relative flex items-center justify-center bg-black ${uploaded ? "pb-28" : ""}`}>

        {/* Landing — upload prompt */}
        {!uploaded && !analyzing && (
          <div className="text-center p-8">
            <div className="text-6xl mb-6">💅</div>
            <h2 className="text-xl font-bold mb-2">네일 아트 체험</h2>
            <p className="text-gray-400 text-sm mb-8">
              손등 사진을 올려주세요.
              <br />
              AI가 분석하여 다양한 네일 디자인을 입혀드립니다.
            </p>
            <button
              onClick={handleUpload}
              className="px-8 py-4 bg-purple-500 hover:bg-purple-600 text-white rounded-full font-semibold transition-colors"
            >
              📷 사진 업로드
            </button>
          </div>
        )}

        {/* Analyzing spinner */}
        {analyzing && (
          <div className="text-center p-8">
            <div className="animate-spin w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-6" />
            <p className="text-gray-300 text-sm mb-1">손톱을 분석하고 있습니다...</p>
            <p className="text-gray-500 text-xs">잠시만 기다려주세요</p>
          </div>
        )}

        {/* Result — after image */}
        {uploaded && !analyzing && (
          <div className="relative w-full h-full flex items-center justify-center p-4">
            <Image
              src={selected.after}
              alt={`${selected.name} 적용 결과`}
              width={800}
              height={600}
              className="max-w-full max-h-full object-contain rounded-lg"
              priority
            />

            {/* Design indicator */}
            <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1.5 backdrop-blur">
              <span className="text-xs">{selected.name}</span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom palette — fixed, shown after upload */}
      {uploaded && (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 z-50">
          <div className="px-4 py-3">
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
                    width={72}
                    height={72}
                    className="w-[72px] h-[72px] object-cover rounded-lg"
                  />
                  <span className="text-[10px] text-gray-400 mt-1 block text-center">
                    {s.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Popup — double click to view sample large */}
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
