import type { CSSProperties } from 'react';
import { accentForeground, readableAccent } from '../colors';
import type { Appearance } from '../types';

export function appearanceVariables(
  appearance: Appearance,
  theme: 'light' | 'dark',
): CSSProperties {
  return {
    '--accent': appearance.accent_color,
    '--accent-fg': accentForeground(appearance.accent_color),
    '--accent-ink': readableAccent(appearance.accent_color, theme),
    '--hero-accent-ink': readableAccent(appearance.accent_color, 'dark'),
    '--radius': `${appearance.border_radius}px`,
    '--background-image': appearance.background_art ? "url('/background-placeholder.png')" : 'none',
    '--background-blur': `${appearance.background_blur}px`,
    '--background-dim': appearance.background_dim / 100,
    '--sidebar-opacity': appearance.sidebar_opacity / 100,
    fontSize: `${appearance.ui_scale}%`,
  } as CSSProperties;
}
