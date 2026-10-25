import type { Appearance, AppearancePreset } from '../types';

export const MAX_APPEARANCE_PRESETS = 32;
const MAX_PRESET_BYTES = 32 * 1024;
const PRESET_KIND = 'paradox-appearance-preset';
const PRESET_SCHEMA_VERSION = 1;
const appearanceKeys = [
  'interface_style',
  'theme',
  'accent_color',
  'ui_scale',
  'border_radius',
  'compact_sidebar',
  'reduce_motion',
  'background_art',
  'background_blur',
  'background_dim',
  'sidebar_opacity',
] as const;

export class PresetValidationError extends Error {
  constructor(
    public readonly key:
      | 'presets.errors.invalidJson'
      | 'presets.errors.invalidFormat'
      | 'presets.errors.unsupportedVersion'
      | 'presets.errors.invalidName'
      | 'presets.errors.invalidAppearance'
      | 'presets.errors.tooLarge',
  ) {
    super(key);
    this.name = 'PresetValidationError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
  );
}

export function validatePresetName(value: string): string {
  const name = value.trim();
  const characters = Array.from(name);
  const containsControl = characters.some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  });
  if (!name || characters.length > 48 || containsControl) {
    throw new PresetValidationError('presets.errors.invalidName');
  }
  return name;
}

/** Only known, complete appearance fields can cross the preset import boundary. */
export function parsePresetAppearance(value: unknown): Appearance {
  if (
    !record(value) ||
    Object.keys(value).length !== appearanceKeys.length ||
    !appearanceKeys.every((key) => Object.hasOwn(value, key)) ||
    typeof value.interface_style !== 'string' ||
    !['immersive', 'modern'].includes(value.interface_style) ||
    typeof value.theme !== 'string' ||
    !['dark', 'light', 'system'].includes(value.theme) ||
    typeof value.accent_color !== 'string' ||
    !/^#[0-9a-f]{6}$/i.test(value.accent_color) ||
    !integerInRange(value.ui_scale, 85, 120) ||
    !integerInRange(value.border_radius, 0, 28) ||
    typeof value.compact_sidebar !== 'boolean' ||
    typeof value.reduce_motion !== 'boolean' ||
    typeof value.background_art !== 'boolean' ||
    !integerInRange(value.background_blur, 0, 16) ||
    !integerInRange(value.background_dim, 0, 60) ||
    !integerInRange(value.sidebar_opacity, 25, 85)
  ) {
    throw new PresetValidationError('presets.errors.invalidAppearance');
  }
  return {
    interface_style: value.interface_style as Appearance['interface_style'],
    theme: value.theme as Appearance['theme'],
    accent_color: value.accent_color,
    ui_scale: value.ui_scale,
    border_radius: value.border_radius,
    compact_sidebar: value.compact_sidebar,
    reduce_motion: value.reduce_motion,
    background_art: value.background_art,
    background_blur: value.background_blur,
    background_dim: value.background_dim,
    sidebar_opacity: value.sidebar_opacity,
  };
}

export function appearancesEqual(left: Appearance, right: Appearance): boolean {
  return appearanceKeys.every((key) => left[key] === right[key]);
}

export function createAppearancePreset(name: string, appearance: Appearance): AppearancePreset {
  return {
    id: crypto.randomUUID(),
    name: validatePresetName(name),
    appearance: parsePresetAppearance(appearance),
  };
}

export function importAppearancePreset(json: string): Omit<AppearancePreset, 'id'> {
  if (new TextEncoder().encode(json).byteLength > MAX_PRESET_BYTES) {
    throw new PresetValidationError('presets.errors.tooLarge');
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new PresetValidationError('presets.errors.invalidJson');
  }
  if (
    !record(value) ||
    Object.keys(value).length !== 4 ||
    !['kind', 'schema_version', 'name', 'appearance'].every((key) => Object.hasOwn(value, key)) ||
    value.kind !== PRESET_KIND ||
    typeof value.name !== 'string'
  ) {
    throw new PresetValidationError('presets.errors.invalidFormat');
  }
  if (value.schema_version !== PRESET_SCHEMA_VERSION) {
    throw new PresetValidationError('presets.errors.unsupportedVersion');
  }
  return {
    name: validatePresetName(value.name),
    appearance: parsePresetAppearance(value.appearance),
  };
}

export function exportAppearancePreset(preset: AppearancePreset): string {
  return JSON.stringify(
    {
      kind: PRESET_KIND,
      schema_version: PRESET_SCHEMA_VERSION,
      name: validatePresetName(preset.name),
      appearance: parsePresetAppearance(preset.appearance),
    },
    null,
    2,
  );
}
