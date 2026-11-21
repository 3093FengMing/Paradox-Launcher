import * as ts from 'typescript';
import { createBindingResolver, unwrap } from './site-bindings';
import type { SuiteSourceTransform } from '../ui-suite/module-graph';
import {
  normalizeSourcePath as normalizePath,
  createSiteCatalog as siteCatalog,
  instrumentHtmlSites,
  siteResult,
} from './html-sites';
import type { InstrumentedSource, UiSiteDefinition } from './html-sites';
export type { InstrumentedSource, UiSiteDefinition } from './html-sites';

const privateNames = new Set([
  'LauncherProvider',
  'UiFoundationProvider',
  'UiFoundationAppearanceBridge',
  'UiFoundationAppearanceBridgeProvider',
  'RecoveryHost',
  'UiEditorProvider',
  'NormalEditorHost',
  'UiIdentity',
  'UiCatalogPresentation',
  'UiRuntimeRoot',
  'UiRuntimeView',
  'SuiteProvider',
]);
const domParts = new Set([
  'Popup',
  'Backdrop',
  'Trigger',
  'Positioner',
  'Item',
  'Title',
  'Description',
  'Close',
  'Separator',
  'Arrow',
  'GroupLabel',
]);
const privatePath = (path: string) =>
  /(?:^|\/)(?:customization|launcher|ui-editor\/controller)\//.test(path) ||
  /(?:^|\/)ui-editor\/(?:controller|host)(?:\.tsx?)?$/.test(path) ||
  /(?:^|\/)ui-foundation\/(?:environment|Identity)(?:\.tsx?)?$/.test(path) ||
  /(?:^|\/)ui-suite\/SuiteProvider(?:\.tsx?)?$/.test(path) ||
  /(?:^|\/)RecoveryHost(?:\.tsx?)?$/.test(path);
/** Resolve imports lexically without filesystem access; private modules remain uninstrumented. */
function resolvedPath(file: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier;
  const parts = file.split('/');
  parts.pop();
  for (const part of specifier.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}
/** Explicit sites accept string literals through TypeScript-only wrappers, never runtime values. */
function explicitSite(attribute: ts.JsxAttribute | undefined, path: string): string | null {
  if (!attribute) return null;
  const value = attribute.initializer;
  if (value && ts.isStringLiteral(value)) return value.text;
  if (value && ts.isJsxExpression(value) && value.expression) {
    const expression = unwrap(value.expression);
    if (ts.isStringLiteral(expression)) return expression.text;
  }
  throw Error(`${path}: data-ui-site must be a static nonempty string.`);
}
/** Instrument JSX call sites while excluding providers and private ownership infrastructure. */
export function createSiteTransformer(
  filePath: string,
  publish?: (definitions: readonly UiSiteDefinition[]) => void,
): ts.TransformerFactory<ts.SourceFile> {
  return (context) => (file) => {
    const path = normalizePath(filePath),
      catalog = siteCatalog(path);
    if (privatePath(path)) {
      publish?.([]);
      return file;
    }
    const bindings = createBindingResolver();
    let fragmentName: ts.Identifier | undefined;
    const attribute = (name: string, value?: string) =>
      ts.factory.createJsxAttribute(
        ts.factory.createIdentifier(name),
        value === undefined ? undefined : ts.factory.createStringLiteral(value),
      );
    const attributes = (node: ts.JsxOpeningElement | ts.JsxSelfClosingElement) => {
      const tag = node.tagName.getText(file),
        root = tag.split('.')[0],
        imported = bindings.origin(ts.factory.createIdentifier(root));
      const part = tag.includes('.') ? tag.split('.').at(-1)! : (imported?.name ?? tag);
      const module = imported?.module ?? '';
      if (
        privateNames.has(part) ||
        privateNames.has(tag) ||
        part === 'Provider' ||
        part === 'Consumer' ||
        part === 'StrictMode' ||
        part === 'Suspense' ||
        (module && privatePath(resolvedPath(path, module)))
      )
        return node.attributes;
      const rows = [...node.attributes.properties];
      const get = (name: string) =>
        rows.find(
          (row): row is ts.JsxAttribute =>
            ts.isJsxAttribute(row) && row.name.getText(file) === name,
        );
      const explicit = get('data-ui-site');
      const explicitValue = explicitSite(explicit, path);
      const targetAttribute = get('data-ui-target');
      const target =
        targetAttribute?.initializer && ts.isStringLiteral(targetAttribute.initializer)
          ? targetAttribute.initializer.text
          : /^[a-z]/.test(tag)
            ? `element.${tag}`
            : part === 'Fragment'
              ? 'fragment'
              : `component.${tag.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;
      const site = catalog.allocate(node.getStart(file), explicitValue, target);
      if (explicit) rows.splice(rows.indexOf(explicit), 1);
      rows.push(attribute('data-ui-site', site), attribute('data-ui-source', path));
      if (!get('data-ui-node')) rows.push(attribute('data-ui-node', target));
      if (
        (module === '@base-ui/react' || module.startsWith('@base-ui/react/')) &&
        domParts.has(part) &&
        !get('data-ui-dom-boundary')
      )
        rows.push(attribute('data-ui-dom-boundary'));
      if (
        part === 'Root' &&
        (module.startsWith('@base-ui/react/dialog') ||
          (module === '@base-ui/react' && imported?.name === 'Dialog')) &&
        !get('data-ui-modal-boundary')
      )
        rows.push(attribute('data-ui-modal-boundary'));
      return ts.factory.updateJsxAttributes(node.attributes, rows);
    };
    const visit: ts.Visitor = (node) => {
      const scoped = ts.isSourceFile(node) || ts.isBlock(node) || ts.isFunctionLike(node);
      if (scoped) bindings.enter(node);
      let result: ts.VisitResult<ts.Node>;
      if (ts.isJsxFragment(node)) {
        fragmentName ??= ts.factory.createUniqueName('__UiSiteFragment');
        const site = catalog.allocate(node.getStart(file), null, 'fragment');
        const fragmentTag = ts.factory.createPropertyAccessExpression(
          fragmentName,
          'Fragment',
        ) as ts.JsxTagNamePropertyAccess;
        result = ts.factory.createJsxElement(
          ts.factory.createJsxOpeningElement(
            fragmentTag,
            undefined,
            ts.factory.createJsxAttributes([
              attribute('data-ui-site', site),
              attribute('data-ui-source', path),
            ]),
          ),
          ts.visitNodes(node.children, visit) as ts.NodeArray<ts.JsxChild>,
          ts.factory.createJsxClosingElement(fragmentTag),
        );
      } else if (ts.isJsxOpeningElement(node))
        result = ts.factory.updateJsxOpeningElement(
          node,
          node.tagName,
          node.typeArguments,
          ts.visitEachChild(attributes(node), visit, context),
        );
      else if (ts.isJsxSelfClosingElement(node))
        result = ts.factory.updateJsxSelfClosingElement(
          node,
          node.tagName,
          node.typeArguments,
          ts.visitEachChild(attributes(node), visit, context),
        );
      else result = ts.visitEachChild(node, visit, context);
      if (scoped) bindings.leave();
      return result;
    };
    let output = ts.visitNode(file, visit) as ts.SourceFile;
    if (fragmentName)
      output = ts.factory.updateSourceFile(output, [
        ts.factory.createImportDeclaration(
          undefined,
          ts.factory.createImportClause(
            false,
            undefined,
            ts.factory.createNamespaceImport(fragmentName),
          ),
          ts.factory.createStringLiteral('react/jsx-runtime'),
        ),
        ...output.statements,
      ]);
    publish?.(catalog.definitions);
    return output;
  };
}

/** Transform source and retain the exact published site catalog used by editor selectors. */
export function instrumentSites(
  source: string,
  filePath: string,
  kind: 'tsx' | 'html',
): InstrumentedSource {
  if (kind === 'html') return instrumentHtmlSites(source, filePath);
  const path = normalizePath(filePath);
  let definitions: readonly UiSiteDefinition[] = [];
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
  );
  const transformed = ts.transform(file, [
    createSiteTransformer(path, (rows) => {
      definitions = rows;
    }),
  ]);
  try {
    source = ts
      .createPrinter({ newLine: ts.NewLineKind.LineFeed })
      .printFile(transformed.transformed[0]);
  } finally {
    transformed.dispose();
  }
  return siteResult(source, path, definitions);
}
export const siteTransformVersion = 'ui-sites-v1.3';
/** Compose instrumentation before caller transforms using a versioned source-cache identity. */
export function suiteSiteTransform(
  publish?: (definitions: readonly UiSiteDefinition[]) => void,
  extra?: SuiteSourceTransform,
): SuiteSourceTransform {
  return {
    cacheKey: `${siteTransformVersion}:${extra?.cacheKey ?? ''}`,
    before: (path) => [createSiteTransformer(path, publish), ...(extra?.before(path) ?? [])],
  };
}
