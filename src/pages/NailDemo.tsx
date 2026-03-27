import { useState } from "react";
import { Link } from "react-router-dom";

const SAMPLES = [
  { id: 1, sample: "/beauty/nail-designs/sample1.jpeg", after: "/beauty/nail-designs/after1.jpeg", name: "디자인 1" },
  { id: 2, sample: "/beauty/nail-designs/sample2.jpeg", after: "/beauty/nail-designs/after2.jpeg", name: "디자인 2" },
  { id: 3, sample: "/beauty/nail-designs/sample3.jpeg", after: "/beauty/nail-designs/after3.jpeg", name: "디자인 3" },
  { id: 4, sample: "/beauty/nail-designs/sample4.jpeg", after: "/beauty/nail-designs/after4.jpeg", name: "디자인 4" },
  { id: 5, sample: "/beauty/nail-designs/sample5.jpeg", after: "/beauty/nail-designs/after5.jpeg", name: "디자인 5" },
];

export default function NailDemoPage() {
  const [selectedId, setSelectedId] = useState(1);
  const [popupSrc, setPopupSrc] = useState<string | null>(null);

  const current = SAMPLES.find((s) => s.id === selectedId)!;

  const takeScreenshot = () => {
    const link = document.createElement("a");
    link.download = `nail-demo-${selectedId}.jpeg`;
    link.href = current.after;
    link.click();
  };

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-900/80 backdrop-blur">
        <Link to="/" className="text-sm text-gray-400 hover:text-white">
          ← 돌아가기
        </Link>
        <h1 className="text-sm font-semibold">💅 네일 아트 Demo</h1>
        <div className="w-16 flex justify-end">
          <button onClick={takeScreenshot} className="text-lg" title="저장">
            📸
          </button>
        </div>
      </header>

      {/* Main area */}
      <div className="flex-1 min-h-0 relative flex items-center justify-center bg-black overflow-hidden">
        <div className="relative w-full h-full flex items-center justify-center p-2">
          <img
            src={current.after}
            alt={`네일 아트 ${current.name}`}
            className="max-w-full max-h-full object-contain"
          />
          <div className="absolute top-4 left-4 bg-purple-500/80 rounded-full px-3 py-1 backdrop-blur">
            <span className="text-xs font-medium">{current.name} 적용</span>
          </div>
        </div>
      </div>

      {/* Bottom panel */}
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
                <img
                  src={s.sample}
                  alt={s.name}
                  className="w-16 h-16 object-cover rounded-lg"
                />
                <span className="text-[10px] text-gray-400 mt-1 block text-center">
                  {s.name}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Link to real nail page */}
        <div className="px-4 pb-3 pt-1">
          <Link
            to="/nail"
            className="block w-full py-3 rounded-full font-semibold text-sm text-center bg-purple-500 hover:bg-purple-600 text-white transition-colors"
          >
            ✨ 내 사진으로 체험하기
          </Link>
        </div>
      </div>

      {/* Popup */}
      {popupSrc && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur flex items-center justify-center p-6"
          onClick={() => setPopupSrc(null)}
        >
          <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={popupSrc}
              alt="네일 디자인 확대"
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
