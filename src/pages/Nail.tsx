import { useState, useRef } from "react";
import { Link } from "react-router-dom";

const SAMPLES = [
  { id: 1, sample: "/beauty/nail-designs/sample1.jpeg", name: "기본" },
  { id: 2, sample: "/beauty/nail-designs/sample2.jpeg", name: "디자인 2" },
  { id: 3, sample: "/beauty/nail-designs/sample3.jpeg", name: "디자인 3" },
  { id: 4, sample: "/beauty/nail-designs/sample4.jpeg", name: "디자인 4" },
  { id: 5, sample: "/beauty/nail-designs/sample5.jpeg", name: "디자인 5" },
];

const COLOR_PRESETS = [
  { name: "레드", hex: "#CC0000" },
  { name: "핑크", hex: "#FF69B4" },
  { name: "코랄", hex: "#FF6F61" },
  { name: "와인", hex: "#722F37" },
  { name: "누드", hex: "#E8C4A2" },
  { name: "베이지", hex: "#D4A574" },
  { name: "라벤더", hex: "#B57EDC" },
  { name: "네이비", hex: "#1B2A4A" },
  { name: "블랙", hex: "#111111" },
  { name: "화이트", hex: "#F5F5F5" },
  { name: "올리브", hex: "#6B7B3A" },
  { name: "스카이", hex: "#87CEEB" },
];

const FINISHES = [
  { id: "glossy", name: "유광", desc: "고광택" },
  { id: "matte", name: "무광", desc: "벨벳" },
  { id: "shimmer", name: "쉬머", desc: "펄" },
  { id: "glitter", name: "글리터", desc: "반짝이" },
  { id: "chrome", name: "크롬", desc: "메탈릭" },
  { id: "syrup", name: "시럽", desc: "투명젤리" },
  { id: "magnet", name: "자석", desc: "캣아이" },
];

const STEPS = [
  { label: "사진 선택" },
  { label: "디자인 선택" },
];

type Mode = null | "solid" | "art";

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-900/50">
      {STEPS.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 ${i <= current ? "text-white" : "text-gray-600"}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              i < current ? "bg-purple-500" : i === current ? "bg-purple-500" : "bg-gray-700"
            }`}>
              {i < current ? "✓" : i + 1}
            </div>
            <span className="text-xs font-medium">{step.label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-8 h-px ${i < current ? "bg-purple-500" : "bg-gray-700"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function NailPage() {
  const [uploadedPhoto, setUploadedPhoto] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [popupSrc, setPopupSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Art mode state
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Solid color mode state
  const [selectedColor, setSelectedColor] = useState(COLOR_PRESETS[0].hex);
  const [customColor, setCustomColor] = useState(COLOR_PRESETS[0].hex);
  const [selectedFinish, setSelectedFinish] = useState("glossy");

  // Current step: 0 = photo, 1 = design
  const currentStep = !uploadedPhoto ? 0 : 1;

  const handleUpload = () => fileInputRef.current?.click();

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setUploadedPhoto(reader.result as string);
      setResultImage(null);
      setMode(null);
      setSelectedId(null);
      setError(null);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const useSamplePhoto = async () => {
    const res = await fetch("/beauty/nail-designs/sample.jpg");
    const blob = await res.blob();
    const reader = new FileReader();
    reader.onload = () => {
      setUploadedPhoto(reader.result as string);
      setResultImage(null);
      setMode(null);
      setSelectedId(null);
      setError(null);
    };
    reader.readAsDataURL(blob);
  };

  // Generate: nail art (sample)
  const generateArtPreview = async () => {
    if (!uploadedPhoto || !selectedId) return;
    setProcessing(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
      const res = await fetch("/beauty/api/nail-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handPhoto: uploadedPhoto, sampleId: selectedId }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "처리 중 오류가 발생했습니다"); return; }
      setResultImage(data.image);
    } catch (err: any) {
      setError(err?.name === "AbortError" ? "요청 시간이 초과되었습니다." : "서버 연결에 실패했습니다");
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  // Generate: solid color
  const generateSolidPreview = async () => {
    if (!uploadedPhoto) return;
    setProcessing(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
      const res = await fetch("/beauty/api/nail-custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handPhoto: uploadedPhoto, color: selectedColor, finish: selectedFinish }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "처리 중 오류가 발생했습니다"); return; }
      setResultImage(data.image);
    } catch (err: any) {
      setError(err?.name === "AbortError" ? "요청 시간이 초과되었습니다." : "서버 연결에 실패했습니다");
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  const retake = () => {
    setUploadedPhoto(null);
    setResultImage(null);
    setMode(null);
    setSelectedId(null);
    setError(null);
  };

  const backToModeSelect = () => {
    setMode(null);
    setResultImage(null);
    setSelectedId(null);
    setError(null);
  };

  const takeScreenshot = () => {
    if (!resultImage) return;
    const link = document.createElement("a");
    link.download = mode === "solid"
      ? `nail-${selectedColor.replace("#", "")}-${selectedFinish}.png`
      : `nail-design-${selectedId}.png`;
    link.href = resultImage;
    link.click();
  };

  const displayImage = resultImage || uploadedPhoto;
  const currentFinish = FINISHES.find((f) => f.id === selectedFinish)!;

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white overflow-hidden">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-900/80 backdrop-blur">
        {uploadedPhoto && mode ? (
          <button onClick={backToModeSelect} className="text-sm text-gray-400 hover:text-white">
            ← 뒤로
          </button>
        ) : uploadedPhoto ? (
          <button onClick={retake} className="text-sm text-gray-400 hover:text-white">
            ← 다시 찍기
          </button>
        ) : (
          <Link to="/" className="text-sm text-gray-400 hover:text-white">
            ← 돌아가기
          </Link>
        )}
        <h1 className="text-sm font-semibold">💅 네일 아트 체험</h1>
        <div className="w-16 flex justify-end">
          {resultImage && (
            <button onClick={takeScreenshot} className="text-lg" title="저장">📸</button>
          )}
        </div>
      </header>

      {/* Stepper */}
      <Stepper current={currentStep} />

      {/* Main area */}
      <div className="flex-1 min-h-0 relative flex items-center justify-center bg-black overflow-hidden">
        {/* Landing — no photo yet */}
        {!uploadedPhoto && (
          <div className="text-center p-8">
            <div className="text-6xl mb-6">💅</div>
            <h2 className="text-xl font-bold mb-2">네일 아트 체험</h2>
            <p className="text-gray-400 text-sm mb-8">
              손등 사진을 올려주세요.<br />AI가 선택한 네일 디자인을 입혀드립니다.
            </p>
            <div className="flex flex-col gap-3 max-w-xs mx-auto">
              <button onClick={handleUpload} className="w-full px-8 py-4 bg-purple-500 hover:bg-purple-600 text-white rounded-full font-semibold transition-colors">
                📷 사진 업로드
              </button>
              <button onClick={useSamplePhoto} className="w-full px-8 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-full font-medium transition-colors">
                🖼️ 기본 사진 사용
              </button>
            </div>
          </div>
        )}

        {/* Display image */}
        {displayImage && (
          <div className="relative w-full h-full flex items-center justify-center p-2">
            <img src={displayImage} alt="네일 아트 결과" className="max-w-full max-h-full object-contain" />
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
              <p className="text-gray-500 text-xs">약 30초~1분 소요</p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="absolute bottom-32 left-4 right-4 text-center">
            <p className="text-red-400 text-sm bg-red-900/30 inline-block px-4 py-2 rounded-full">{error}</p>
          </div>
        )}
      </div>

      {/* Bottom panel */}
      {uploadedPhoto && (
        <div className="bg-gray-900 border-t border-gray-800 flex-shrink-0">

          {/* Mode select */}
          {!mode && !resultImage && (
            <div className="px-4 py-4">
              <p className="text-xs text-gray-400 text-center mb-3">디자인 방식을 선택하세요</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setMode("solid")}
                  className="flex-1 py-4 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors text-center"
                >
                  <span className="text-2xl block mb-1">🎨</span>
                  <span className="text-sm font-semibold block">원컬러</span>
                  <span className="text-[10px] text-gray-500">컬러 + 광택 선택</span>
                </button>
                <button
                  onClick={() => setMode("art")}
                  className="flex-1 py-4 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors text-center"
                >
                  <span className="text-2xl block mb-1">💅</span>
                  <span className="text-sm font-semibold block">네일 아트</span>
                  <span className="text-[10px] text-gray-500">시안 디자인 선택</span>
                </button>
              </div>
            </div>
          )}

          {/* Art mode — sample selection */}
          {mode === "art" && (
            <>
              <div className="px-4 pt-3 pb-2">
                <p className="text-[10px] text-gray-500 mb-2">네일 디자인 선택 (더블클릭으로 확대)</p>
                <div className="flex gap-3 overflow-x-auto scrollbar-hide">
                  {SAMPLES.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      onDoubleClick={() => setPopupSrc(s.sample)}
                      className={`flex-shrink-0 transition-all ${
                        selectedId === s.id ? "ring-2 ring-purple-500 scale-105" : "opacity-70 hover:opacity-100"
                      }`}
                    >
                      <img src={s.sample} alt={s.name} className="w-16 h-16 object-cover rounded-lg" />
                      <span className="text-[10px] text-gray-400 mt-1 block text-center">{s.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="px-4 pb-3 pt-1">
                <button
                  onClick={generateArtPreview}
                  disabled={!selectedId || processing}
                  className={`w-full py-3 rounded-full font-semibold text-sm transition-colors ${
                    selectedId && !processing ? "bg-purple-500 hover:bg-purple-600 text-white" : "bg-gray-700 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  {processing ? "처리 중..." : selectedId ? "✨ 미리보기 생성" : "디자인을 선택하세요"}
                </button>
              </div>
            </>
          )}

          {/* Solid color mode */}
          {mode === "solid" && (
            <>
              <div className="px-4 pt-3 pb-2 space-y-3">
                <div>
                  <p className="text-[10px] text-gray-500 mb-2">컬러 선택</p>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1.5 overflow-x-auto scrollbar-hide flex-1">
                      {COLOR_PRESETS.map((c) => (
                        <button
                          key={c.hex}
                          onClick={() => { setSelectedColor(c.hex); setCustomColor(c.hex); }}
                          className={`flex-shrink-0 w-8 h-8 rounded-full border-2 transition-all ${
                            selectedColor === c.hex ? "border-white scale-110" : "border-gray-600 hover:border-gray-400"
                          }`}
                          style={{ backgroundColor: c.hex }}
                          title={c.name}
                        />
                      ))}
                    </div>
                    <input
                      type="color"
                      value={customColor}
                      onChange={(e) => { setCustomColor(e.target.value); setSelectedColor(e.target.value); }}
                      className="flex-shrink-0 w-8 h-8 rounded-full cursor-pointer border-2 border-gray-600"
                      title="직접 선택"
                    />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 mb-2">광택</p>
                  <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
                    {FINISHES.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setSelectedFinish(f.id)}
                        className={`flex-shrink-0 px-3 py-2 rounded-lg text-center transition-all ${
                          selectedFinish === f.id
                            ? "bg-purple-500/30 border border-purple-500 text-white"
                            : "bg-gray-800 border border-gray-700 text-gray-400 hover:text-white"
                        }`}
                      >
                        <span className="text-xs font-medium block">{f.name}</span>
                        <span className="text-[10px] text-gray-500">{f.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="px-4 pb-3 pt-1">
                <button
                  onClick={generateSolidPreview}
                  disabled={processing}
                  className={`w-full py-3 rounded-full font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${
                    !processing ? "bg-purple-500 hover:bg-purple-600 text-white" : "bg-gray-700 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  <span className="w-4 h-4 rounded-full border border-white/30 inline-block" style={{ backgroundColor: selectedColor }} />
                  {processing ? "처리 중..." : `${currentFinish.name} 미리보기 생성`}
                </button>
              </div>
            </>
          )}

          {/* Result shown */}
          {resultImage && (
            <div className="px-4 py-3">
              <button
                onClick={backToModeSelect}
                className="w-full py-3 rounded-full font-semibold text-sm bg-gray-700 hover:bg-gray-600 text-white transition-colors"
              >
                다른 디자인 선택하기
              </button>
            </div>
          )}
        </div>
      )}

      {/* Popup */}
      {popupSrc && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur flex items-center justify-center p-6" onClick={() => setPopupSrc(null)}>
          <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <img src={popupSrc} alt="네일 디자인 확대" className="w-full h-auto rounded-xl" />
            <button onClick={() => setPopupSrc(null)} className="absolute top-3 right-3 w-8 h-8 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-black/80">
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
