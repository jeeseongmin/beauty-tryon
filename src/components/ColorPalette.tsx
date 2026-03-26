"use client";

import { HairColor, hairCategories } from "@/data/products";

interface ColorPaletteProps {
  colors: HairColor[];
  selectedId: string | null;
  onSelect: (color: HairColor) => void;
}

export default function ColorPalette({
  colors,
  selectedId,
  onSelect,
}: ColorPaletteProps) {
  return (
    <div className="w-full">
      {hairCategories.map((cat) => {
        const catColors = colors.filter((c) => c.category === cat.key);
        if (catColors.length === 0) return null;
        return (
          <div key={cat.key} className="mb-3">
            <p className="text-xs text-gray-400 mb-1.5 px-1">{cat.label}</p>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide px-1">
              {catColors.map((color) => (
                <button
                  key={color.id}
                  onClick={() => onSelect(color)}
                  className={`color-swatch flex-shrink-0 ${
                    selectedId === color.id ? "active" : ""
                  }`}
                  style={{ backgroundColor: color.hex }}
                  title={color.name}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
