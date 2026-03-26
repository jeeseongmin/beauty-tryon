"use client";

import { NailDesign } from "@/data/products";

interface NailPaletteProps {
  designs: NailDesign[];
  selectedId: string | null;
  onSelect: (design: NailDesign) => void;
}

export default function NailPalette({
  designs,
  selectedId,
  onSelect,
}: NailPaletteProps) {
  return (
    <div className="w-full">
      <div className="flex gap-3 overflow-x-auto scrollbar-hide px-1 pb-2">
        {designs.map((design) => (
          <button
            key={design.id}
            onClick={() => onSelect(design)}
            className={`flex-shrink-0 flex flex-col items-center gap-1 transition-all ${
              selectedId === design.id ? "scale-110" : ""
            }`}
          >
            <div
              className={`w-12 h-12 rounded-xl border-2 transition-all ${
                selectedId === design.id
                  ? "border-purple-500 shadow-lg"
                  : "border-gray-200"
              }`}
              style={{
                background:
                  design.colors.length > 1
                    ? `linear-gradient(135deg, ${design.colors.join(", ")})`
                    : design.colors[0],
              }}
            >
              {design.pattern === "glitter" && (
                <div className="w-full h-full rounded-xl bg-white/20 flex items-center justify-center text-sm">
                  ✨
                </div>
              )}
            </div>
            <span className="text-[10px] text-gray-500 whitespace-nowrap">
              {design.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
