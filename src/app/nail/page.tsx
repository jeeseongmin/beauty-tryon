"use client";

import { useState } from "react";
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
  const [selectedId, setSelectedId] = useState<number>(1);
  const [popupSrc, setPopupSrc] = useState<string | null>(null);

  const selected = SAMPLES.find((s) => s.id === selectedId)!;

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

      {/* Main — after image */}
      <div className="flex-1 relative flex items-center justify-center bg-black pb-28">
        <div className="relative w-full h-full flex items-center justify-center p-4">
          <Image
            src={selected.after}
            alt={`${selected.name} 적용 결과`}
            width={800}
            height={600}
            className="max-w-full max-h-full object-contain rounded-lg"
            priority
          />
        </div>

        {/* Selected design indicator */}
        <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1.5 backdrop-blur">
          <span className="text-xs">{selected.name}</span>
        </div>
      </div>

      {/* Bottom palette — fixed, shows sample thumbnails */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 z-50">
        <div className="px-4 py-3">
          <p className="text-[10px] text-gray-500 mb-2">네일 디자인 선택</p>
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
