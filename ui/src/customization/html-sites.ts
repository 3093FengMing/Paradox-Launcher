export interface InstrumentedSource {
  source: string;
  sites: ReadonlyMap<string, string>;
  diagnostics: readonly string[];
}
export interface UiSiteDefinition {
  readonly site: string;
  readonly target: string;
  readonly sourcePath: string;
  readonly automatic: boolean;
}
export const normalizeSourcePath = (path: string) =>
  path.replaceAll('\\', '/').replace(/^.*\/ui\/src\//, 'src/');
/** Shared source-position allocation; an explicit ID is scoped to its materialized file. */
export function createSiteCatalog(path: string) {
  const definitions: UiSiteDefinition[] = [],
    explicit = new Set<string>();
  return {
    definitions,
    allocate(offset: number, name: string | null, target: string) {
      if (name !== null && (!name || explicit.has(name)))
        throw Error(`${path}: Duplicate or empty explicit data-ui-site ${JSON.stringify(name)}.`);
      if (name !== null) explicit.add(name);
      const site = `${name === null ? 'auto' : 'site'}:${encodeURIComponent(path)}:${name === null ? offset : encodeURIComponent(name)}`;
      definitions.push(Object.freeze({ site, target, sourcePath: path, automatic: name === null }));
      return site;
    },
  };
}
/** Quote-aware HTML opening-node parser. Offsets are retained before DOMParser normalization. */
function htmlSites(
  source: string,
  path: string,
): { source: string; definitions: UiSiteDefinition[] } {
  const catalog = createSiteCatalog(path),
    edits: { start: number; end: number; text: string }[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start < 0) break;
    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4);
      cursor = end < 0 ? source.length : end + 3;
      continue;
    }
    cursor = start + 1;
    const name = /^[a-zA-Z][\w:-]*/.exec(source.slice(cursor))?.[0];
    if (!name) continue;
    cursor += name.length;
    const attrs: { name: string; value: string; start: number; end: number }[] = [];
    while (cursor < source.length) {
      while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++;
      if (source[cursor] === '>' || source.startsWith('/>', cursor)) break;
      const attrStart = cursor;
      while (cursor < source.length && !/[\s=>/]/.test(source[cursor])) cursor++;
      const attrName = source.slice(attrStart, cursor).toLowerCase();
      if (!attrName) {
        cursor++;
        continue;
      }
      while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++;
      let value = '';
      if (source[cursor] === '=') {
        cursor++;
        while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++;
        const quote = source[cursor];
        if (quote === '"' || quote === "'") {
          const valueStart = ++cursor;
          while (cursor < source.length && source[cursor] !== quote) cursor++;
          value = source.slice(valueStart, cursor);
          cursor++;
        } else {
          const valueStart = cursor;
          while (cursor < source.length && !/[\s>]/.test(source[cursor])) cursor++;
          value = source.slice(valueStart, cursor);
        }
      }
      attrs.push({ name: attrName, value, start: attrStart, end: cursor });
    }
    const explicit = attrs.filter((attr) => attr.name === 'data-ui-site');
    if (explicit.length > 1) throw Error(`${path}: Duplicate data-ui-site attribute.`);
    const target =
      attrs.find((attr) => attr.name === 'data-ui-target')?.value ??
      `element.${name.toLowerCase()}`;
    const site = catalog.allocate(start, explicit[0]?.value ?? null, target);
    const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    if (explicit[0]) edits.push({ start: explicit[0].start, end: explicit[0].end, text: '' });
    edits.push({
      start: cursor,
      end: cursor,
      text: ` data-ui-site="${escape(site)}" data-ui-source="${escape(path)}"`,
    });
    cursor += source.startsWith('/>', cursor) ? 2 : 1;
    if (['script', 'style', 'textarea', 'title'].includes(name.toLowerCase())) {
      const end = source.toLowerCase().indexOf(`</${name.toLowerCase()}`, cursor);
      cursor = end < 0 ? source.length : end;
    }
  }
  for (const edit of edits.sort((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return { source, definitions: catalog.definitions };
}

export function siteResult(
  source: string,
  path: string,
  definitions: readonly UiSiteDefinition[],
): InstrumentedSource {
  return {
    source,
    sites: new Map(definitions.map((row) => [row.site, row.sourcePath])),
    diagnostics: definitions.some((row) => row.automatic)
      ? [
          `${path}: Automatic sites may become unresolved after source edits; use explicit data-ui-site for persistent positions.`,
        ]
      : [],
  };
}
export function instrumentHtmlSites(source: string, filePath: string): InstrumentedSource {
  const path = normalizeSourcePath(filePath),
    result = htmlSites(source, path);
  return siteResult(result.source, path, result.definitions);
}
