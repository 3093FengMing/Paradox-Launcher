import type { CSSProperties } from 'react';
import { accentForeground, readableAccent } from '../colors';
import type { Appearance, Personalization } from '../types';
import { defaultPersonalization } from './preferences';

const fonts: Record<Personalization['font'], string> = {
  system: '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
  yahei: '"Microsoft YaHei", "PingFang SC", sans-serif',
  arial: 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  monospace: 'Consolas, "Cascadia Code", monospace',
};

export function appearanceVariables(
  appearance: Appearance,
  theme: 'light' | 'dark',
  personalization: Personalization = defaultPersonalization(),
  background: string | null = null,
): CSSProperties {
  const customImage = background?.startsWith('data:image/png;base64,')
    ? `url("${background}")`
    : null;
  return {
    '--accent': appearance.accent_color,
    '--accent-fg': accentForeground(appearance.accent_color),
    '--accent-ink': readableAccent(appearance.accent_color, theme),
    '--hero-accent-ink': readableAccent(appearance.accent_color, 'dark'),
    '--radius': `${appearance.border_radius}px`,
    ...(appearance.background_art ? (customImage ? { '--background-image': customImage } : {}) : { '--background-image': 'none' }),
    ...(customImage ? { '--banner-image': customImage } : {}),
    '--background-size':
      personalization.background_fit === 'stretch' ? '100% 100%' : personalization.background_fit,
    '--background-blur': `${appearance.background_blur}px`,
    '--background-dim': appearance.background_dim / 100,
    '--sidebar-opacity': appearance.sidebar_opacity / 100,
    fontSize: `${appearance.ui_scale}%`,
    fontFamily: fonts[personalization.font],
  } as CSSProperties;
}
