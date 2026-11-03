import type { ArgumentTemplate } from '../types';
import { normalizeArgumentTemplates } from './preferences';

export interface EnvironmentRow {
  key: string;
  value: string;
}
export interface ArgumentTemplateDraft {
  id: string;
  name: string;
  jvm: string;
  game: string;
  environment: EnvironmentRow[];
}

const encoder = new TextEncoder();
const windowsEnvironment = () =>
  typeof navigator !== 'undefined' && /win/i.test(navigator.platform);

export function environmentRows(environment: Record<string, string> = {}): EnvironmentRow[] {
  return Object.entries(environment).map(([key, value]) => ({ key, value }));
}

/** Values are literal: preserve empty strings, whitespace, newlines and equals signs. */
export function environmentFromRows(
  rows: EnvironmentRow[],
  windows = windowsEnvironment(),
): Record<string, string> {
  if (rows.length > 64) throw new Error('content.errors.environment');
  const keys = new Set<string>();
  const entries = rows.map(({ key, value }) => {
    const identity = windows ? key.toUpperCase() : key;
    if (
      !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) ||
      keys.has(identity) ||
      ['JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS'].includes(key.toUpperCase()) ||
      encoder.encode(value).length > 8192 ||
      value.includes('\0')
    )
      throw new Error('content.errors.environment');
    keys.add(identity);
    return [key, value] as const;
  });
  return Object.fromEntries(entries);
}

export function saveArgumentTemplate(
  templates: ArgumentTemplate[],
  draft: ArgumentTemplateDraft,
  windows = windowsEnvironment(),
): ArgumentTemplate[] {
  const candidate = { ...draft, environment: environmentFromRows(draft.environment, windows) };
  const found = templates.some((template) => template.id === draft.id);
  const result = found
    ? templates.map((template) => (template.id === draft.id ? candidate : template))
    : [...templates, candidate];
  return normalizeArgumentTemplates(result);
}

export function removeArgumentTemplate(
  templates: ArgumentTemplate[],
  id: string,
  usedTemplateIds: readonly string[],
): ArgumentTemplate[] {
  if (usedTemplateIds.includes(id)) throw new Error('argumentTemplates.inUse');
  return templates.filter((template) => template.id !== id);
}
