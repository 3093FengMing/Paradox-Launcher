import * as ts from 'typescript';
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
interface Origin {
  name: string;
  module: string;
  namespace: boolean;
}
interface BindingScope {
  bindings: Map<string, Binding>;
  parent: BindingScope | null;
}
interface AliasBinding {
  expression: ts.Expression;
  scope: BindingScope;
  path: readonly string[];
}
type Binding = Origin | AliasBinding | null;
function unwrap(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression;
  return node;
}
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
    const scopes: BindingScope[] = [];
    let fragmentName: ts.Identifier | undefined;
    const bindName = (name: ts.BindingName, value: AliasBinding | null, scope: BindingScope) => {
      if (ts.isIdentifier(name)) scope.bindings.set(name.text, value);
      else
        for (const [index, element] of name.elements.entries()) {
          if (!ts.isBindingElement(element)) continue;
          const property =
            element.propertyName ?? (ts.isIdentifier(element.name) ? element.name : undefined);
          const key = ts.isArrayBindingPattern(name)
            ? String(index)
            : property &&
                (ts.isIdentifier(property) ||
                  ts.isStringLiteral(property) ||
                  ts.isNumericLiteral(property))
              ? property.text
              : null;
          // Only immutable, statically named destructuring retains provenance.
          bindName(
            element.name,
            value && key !== null && !element.dotDotDotToken && !element.initializer
              ? { ...value, path: [...value.path, key] }
              : null,
            scope,
          );
        }
    };
    const scopeFor = (node: ts.Node) => {
      const scope: BindingScope = { bindings: new Map(), parent: scopes.at(-1) ?? null };
      if (ts.isFunctionLike(node))
        for (const parameter of node.parameters) bindName(parameter.name, null, scope);
      const statements = ts.isSourceFile(node) || ts.isBlock(node) ? node.statements : [];
      for (const statement of statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
          const module = statement.moduleSpecifier.text,
            clause = statement.importClause;
          if (clause?.name)
            scope.bindings.set(clause.name.text, {
              name: clause.name.text,
              module,
              namespace: false,
            });
          if (clause?.namedBindings) {
            const bindings = clause.namedBindings;
            if (ts.isNamespaceImport(bindings))
              scope.bindings.set(bindings.name.text, { name: '*', module, namespace: true });
            else
              for (const item of bindings.elements)
                scope.bindings.set(item.name.text, {
                  name: item.propertyName?.text ?? item.name.text,
                  module,
                  namespace: false,
                });
          }
        } else if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations)
            bindName(
              declaration.name,
              statement.declarationList.flags & ts.NodeFlags.Const && declaration.initializer
                ? { expression: declaration.initializer, scope, path: [] }
                : null,
              scope,
            );
        } else if (
          (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
          statement.name
        )
          scope.bindings.set(statement.name.text, null);
      }
      return scope;
    };
    const member = (base: Origin | null, name: string | null): Origin | null =>
      name && (base || name === 'Provider' || name === 'Consumer')
        ? { name, module: base?.module ?? '', namespace: false }
        : null;
    const origin = (
      expression: ts.Expression,
      scope = scopes.at(-1) ?? null,
      seen = new Set<Binding>(),
    ): Origin | null => {
      const node = unwrap(expression);
      if (ts.isIdentifier(node)) {
        for (let lexical = scope; lexical; lexical = lexical.parent)
          if (lexical.bindings.has(node.text)) {
            const binding = lexical.bindings.get(node.text)!;
            if (!binding || seen.has(binding)) return null;
            seen.add(binding);
            if ('module' in binding) return binding;
            let result = origin(binding.expression, binding.scope, seen);
            for (const property of binding.path) result = member(result, property);
            return result;
          }
      } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const base = origin(node.expression, scope, seen);
        const name = ts.isPropertyAccessExpression(node)
          ? node.name.text
          : ts.isStringLiteral(node.argumentExpression)
            ? node.argumentExpression.text
            : null;
        return member(base, name);
      } else if (ts.isCallExpression(node)) {
        const called = origin(node.expression, scope, seen);
        if (called?.module === 'react' && called.name === 'createContext')
          return { name: 'Provider', module: 'react', namespace: false };
      }
      return null;
    };
    const attribute = (name: string, value?: string) =>
      ts.factory.createJsxAttribute(
        ts.factory.createIdentifier(name),
        value === undefined ? undefined : ts.factory.createStringLiteral(value),
      );
    const attributes = (node: ts.JsxOpeningElement | ts.JsxSelfClosingElement) => {
      const tag = node.tagName.getText(file),
        root = tag.split('.')[0],
        imported = origin(ts.factory.createIdentifier(root));
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
      let explicitValue: string | null = null;
      if (explicit) {
        const value = explicit.initializer;
        if (value && ts.isStringLiteral(value)) explicitValue = value.text;
        else if (
          value &&
          ts.isJsxExpression(value) &&
          value.expression &&
          ts.isStringLiteral(unwrap(value.expression))
        )
          explicitValue = (unwrap(value.expression) as ts.StringLiteral).text;
        else throw Error(`${path}: data-ui-site must be a static nonempty string.`);
      }
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
      if (scoped) scopes.push(scopeFor(node));
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
      if (scoped) scopes.pop();
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
export function suiteSiteTransform(
  publish?: (definitions: readonly UiSiteDefinition[]) => void,
  extra?: SuiteSourceTransform,
): SuiteSourceTransform {
  return {
    cacheKey: `${siteTransformVersion}:${extra?.cacheKey ?? ''}`,
    before: (path) => [createSiteTransformer(path, publish), ...(extra?.before(path) ?? [])],
  };
}
