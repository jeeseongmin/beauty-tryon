export interface HairColor {
  id: string;
  name: string;
  nameEn: string;
  hex: string;
  rgb: [number, number, number];
  category: "natural" | "vivid" | "ash" | "warm";
}

export interface NailDesign {
  id: string;
  name: string;
  thumbnail: string;
  pattern: "solid" | "gradient" | "art" | "glitter";
  colors: string[];
}

export const hairColors: HairColor[] = [
  // Natural
  { id: "h1", name: "내추럴 블랙", nameEn: "Natural Black", hex: "#1a1a1a", rgb: [26, 26, 26], category: "natural" },
  { id: "h2", name: "다크 브라운", nameEn: "Dark Brown", hex: "#3b2314", rgb: [59, 35, 20], category: "natural" },
  { id: "h3", name: "초콜릿 브라운", nameEn: "Chocolate Brown", hex: "#5c3317", rgb: [92, 51, 23], category: "natural" },
  { id: "h4", name: "허니 브라운", nameEn: "Honey Brown", hex: "#8b6914", rgb: [139, 105, 20], category: "natural" },
  { id: "h5", name: "밀크 브라운", nameEn: "Milk Brown", hex: "#a67b5b", rgb: [166, 123, 91], category: "natural" },
  // Ash
  { id: "h6", name: "애쉬 그레이", nameEn: "Ash Gray", hex: "#8a8a8a", rgb: [138, 138, 138], category: "ash" },
  { id: "h7", name: "애쉬 브라운", nameEn: "Ash Brown", hex: "#6b5b4f", rgb: [107, 91, 79], category: "ash" },
  { id: "h8", name: "애쉬 블루", nameEn: "Ash Blue", hex: "#4a6b7a", rgb: [74, 107, 122], category: "ash" },
  // Vivid
  { id: "h9", name: "레드 와인", nameEn: "Red Wine", hex: "#722f37", rgb: [114, 47, 55], category: "vivid" },
  { id: "h10", name: "버건디", nameEn: "Burgundy", hex: "#800020", rgb: [128, 0, 32], category: "vivid" },
  { id: "h11", name: "로즈 핑크", nameEn: "Rose Pink", hex: "#c76b8a", rgb: [199, 107, 138], category: "vivid" },
  { id: "h12", name: "블루 바이올렛", nameEn: "Blue Violet", hex: "#4b3d8f", rgb: [75, 61, 143], category: "vivid" },
  // Warm
  { id: "h13", name: "오렌지 브라운", nameEn: "Orange Brown", hex: "#a0522d", rgb: [160, 82, 45], category: "warm" },
  { id: "h14", name: "골든 블론드", nameEn: "Golden Blonde", hex: "#c4a35a", rgb: [196, 163, 90], category: "warm" },
  { id: "h15", name: "카라멜", nameEn: "Caramel", hex: "#a0724a", rgb: [160, 114, 74], category: "warm" },
];

export const nailDesigns: NailDesign[] = [
  { id: "n1", name: "클래식 레드", thumbnail: "", pattern: "solid", colors: ["#cc0000"] },
  { id: "n2", name: "누드 핑크", thumbnail: "", pattern: "solid", colors: ["#e8b4b8"] },
  { id: "n3", name: "프렌치 화이트", thumbnail: "", pattern: "art", colors: ["#fce4ec", "#ffffff"] },
  { id: "n4", name: "베리 퍼플", thumbnail: "", pattern: "solid", colors: ["#7b1fa2"] },
  { id: "n5", name: "코랄 오렌지", thumbnail: "", pattern: "solid", colors: ["#ff7043"] },
  { id: "n6", name: "체리 블라썸", thumbnail: "", pattern: "gradient", colors: ["#f8bbd0", "#ffffff"] },
  { id: "n7", name: "미드나잇 블루", thumbnail: "", pattern: "solid", colors: ["#1a237e"] },
  { id: "n8", name: "라벤더", thumbnail: "", pattern: "solid", colors: ["#b39ddb"] },
  { id: "n9", name: "글리터 골드", thumbnail: "", pattern: "glitter", colors: ["#ffd700"] },
  { id: "n10", name: "홀로그램 실버", thumbnail: "", pattern: "glitter", colors: ["#c0c0c0", "#e0e0ff"] },
  { id: "n11", name: "로즈 골드", thumbnail: "", pattern: "solid", colors: ["#b76e79"] },
  { id: "n12", name: "네온 그린", thumbnail: "", pattern: "solid", colors: ["#76ff03"] },
];

export const hairCategories = [
  { key: "natural" as const, label: "내추럴" },
  { key: "ash" as const, label: "애쉬" },
  { key: "vivid" as const, label: "비비드" },
  { key: "warm" as const, label: "웜톤" },
];
