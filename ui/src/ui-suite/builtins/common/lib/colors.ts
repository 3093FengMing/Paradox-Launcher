function rgb(hex: string): number[] {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
}
function luminance(color: number[]): number {
  const channels = color
    .map((value) => value / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function accentForeground(hex: string): string {
  const background = luminance(rgb(hex));
  const ink = '#0d1022';
  if ((background + 0.05) / (luminance(rgb(ink)) + 0.05) >= 4.5) return ink;
  if (1.05 / (background + 0.05) >= 4.5) return '#ffffff';
  return '#000000';
}
