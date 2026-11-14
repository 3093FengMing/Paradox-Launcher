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
export function readableAccent(hex: string, theme: string): string {
  if (hex.toLowerCase() === '#6676dc') return theme === 'light' ? '#4357b4' : '#b0bcff';
  const color = rgb(hex);
  const surfaces = theme === 'light' ? ['#edf1f7', '#ffffff', '#e5e9fa'] : ['#24272d', '#30353d', '#3d465c'];
  const backgrounds = surfaces.map(surface => luminance(rgb(surface)));
  const target = theme === 'light' ? 0 : 255;
  for (let step = 0; step <= 20; step++) {
    const mixed = color.map((value) => Math.round(value + ((target - value) * step) / 20));
    const foreground = luminance(mixed);
    if (backgrounds.every(background => (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) >= 4.5)) {
      return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return theme === 'light' ? '#0d1022' : '#edf1f7';
}
