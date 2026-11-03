import type { ArgumentTemplate, Personalization } from '../types';
import { validateRouteId } from '../ui-suite/routes';

const encoder = new TextEncoder();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  if (value.length === 32) return /^[0-9a-f]{32}$/i.test(value);
  if (value.length === 38 && value.startsWith('{') && value.endsWith('}')) {
    value = value.slice(1, -1);
  } else if (value.length === 45 && value.slice(0, 9).toLowerCase() === 'urn:uuid:') {
    value = value.slice(9);
  }
  return value.length === 36 && uuidPattern.test(value);
}

export function defaultPersonalization(): Personalization {
  return {
    background_file: '',
    background_fit: 'cover',
    font: 'system',
    startup_page: 'home',
    notifications: true,
    retain_logs: false,
    shortcuts: true,
    launch_shortcut: 'Ctrl+Enter',
  };
}

/** Match the defaults and validation used by the desktop configuration. */
export function normalizePersonalization(value: unknown): Personalization {
  if (value === undefined) return defaultPersonalization();
  if (!isRecord(value)) throw new Error('content.errors.preferences');
  const normalized = { ...defaultPersonalization(), ...value };
  if (
    typeof normalized.background_file !== 'string' ||
    (normalized.background_file !== '' &&
      (normalized.background_file.length !== 68 ||
        !/^[0-9a-fA-F]{64}\.png$/.test(normalized.background_file))) ||
    !['cover', 'contain', 'stretch'].includes(normalized.background_fit)
  )
    throw new Error('content.errors.background');
  if (
    !['system', 'yahei', 'arial', 'serif', 'monospace'].includes(normalized.font) ||
    !['Ctrl+Enter', 'Ctrl+Shift+L', 'Alt+Enter'].includes(normalized.launch_shortcut) ||
    typeof normalized.notifications !== 'boolean' ||
    typeof normalized.retain_logs !== 'boolean' ||
    typeof normalized.shortcuts !== 'boolean'
  )
    throw new Error('content.errors.preferences');
  return { ...normalized, startup_page: validateRouteId(normalized.startup_page) };
}

function parseEnvironment(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.keys(value).length > 64)
    throw new Error('content.errors.environment');
  const entries = Object.entries(value).map(([key, text]) => {
    if (
      !/^[A-Za-z_]/.test(key) ||
      /[^A-Za-z0-9_]/.test(key) ||
      key.length > 128 ||
      ['JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS'].includes(key.toUpperCase()) ||
      typeof text !== 'string' ||
      encoder.encode(text).length > 8192 ||
      text.includes('\0')
    )
      throw new Error('content.errors.environment');
    return [key, text] as const;
  });
  return Object.fromEntries(entries);
}

export function normalizeArgumentTemplates(value: unknown): ArgumentTemplate[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) throw new Error('content.errors.templates');
  const ids = new Set<string>();
  return value.map((template: unknown) => {
    if (
      !isRecord(template) ||
      typeof template.id !== 'string' ||
      !isUuid(template.id) ||
      ids.has(template.id) ||
      typeof template.name !== 'string' ||
      Array.from(template.name).length < 1 ||
      Array.from(template.name).length > 48 ||
      /[\p{Cc}]/u.test(template.name) ||
      typeof template.jvm !== 'string' ||
      encoder.encode(template.jvm).length > 8192 ||
      template.jvm.includes('\0') ||
      typeof template.game !== 'string' ||
      encoder.encode(template.game).length > 8192 ||
      template.game.includes('\0')
    )
      throw new Error('content.errors.templates');
    ids.add(template.id);
    return {
      id: template.id,
      name: template.name,
      jvm: template.jvm,
      game: template.game,
      environment: parseEnvironment(template.environment),
    };
  });
}
