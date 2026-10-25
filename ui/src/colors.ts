function rgb(hex: string): number[] {
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
}
function luminance(color: number[]): number {
  const channels = color.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function accentForeground(hex: string): string {
  return luminance(rgb(hex)) > 0.179 ? '#17200d' : '#ffffff';
}
export function readableAccent(hex: string, theme: string): string {
  const color = rgb(hex);
  const background = luminance(rgb(theme === 'light' ? '#f5f7f2' : '#101211'));
  const target = theme === 'light' ? 0 : 255;
  for (let step = 0; step <= 20; step++) {
    const mixed = color.map(value => Math.round(value + (target - value) * step / 20));
    const foreground = luminance(mixed);
    if ((Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) >= 4.5) {
      return `#${mixed.map(value => value.toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return theme === 'light' ? '#17200d' : '#eef1e9';
}
