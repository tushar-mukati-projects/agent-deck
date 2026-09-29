const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const parseHex = (hex: string): [number, number, number] => {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? [...clean].map((c) => c + c).join("") : clean.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
};

const toHex = (rgb: number[]) =>
  `#${rgb
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const luminance = (hex: string) => {
  const [r, g, b] = parseHex(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

export const mix = (from: string, to: string, amount: number) => {
  const a = parseHex(from);
  const b = parseHex(to);
  return toHex(a.map((v, i) => v + (b[i] - v) * amount));
};

export const ensureContrast = (color: string, background: string, ratio: number) => {
  if (contrast(color, background) >= ratio) return color;
  const target = luminance(background) > 0.5 ? "#000000" : "#ffffff";
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    if (contrast(mix(color, target, middle), background) >= ratio) high = middle;
    else low = middle;
  }
  return mix(color, target, high);
};
