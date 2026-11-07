import * as ts from 'typescript';
import { canonicalSuiteJson, compareCodePoints } from './canonical';
import { resolveSuitePath } from './paths';
import type { UiSuiteBundle } from './model';
import { createModuleGraph } from './module-graph-runtime';
import type { GraphModule, SuiteModuleGraph } from './module-graph-runtime';
export { moduleBlobSource } from './module-graph-runtime';
export type { SuiteModuleGraph } from './module-graph-runtime';

/** Shared source transformation runs here, before JSX/type erasure. */
export interface SuiteSourceTransform {
  readonly cacheKey: string;
  before(sourcePath: string): ts.TransformerFactory<ts.SourceFile>[];
}
function fail(file: ts.SourceFile, node: ts.Node, message: string): never {
  const pos = file.getLineAndCharacterOfPosition(node.getStart(file));
  throw new Error(`${file.fileName}:${pos.line + 1}:${pos.character + 1}: ${message}`);
}

/** Pure preparation only. The caller must fully validate before acquiring/executing it. */
export function buildModuleGraph(
  bundle: UiSuiteBundle,
  entries: readonly string[],
  publicNames: readonly string[],
  transform?: SuiteSourceTransform,
): SuiteModuleGraph {
  const files = new Map(Object.entries(bundle.files));
  const descriptors = new Map(bundle.manifest.files.map((f) => [f.path, f]));
  const modules = new Map<string, GraphModule>();
  const identity: unknown[] = [];
  const visit = (path: string) => {
    if (modules.has(path)) return;
    const input = files.get(path),
      descriptor = descriptors.get(path);
    if (!input || !descriptor) throw new Error(`${path}:1:1: Missing module.`);
    if (descriptor.kind === 'html')
      throw new Error(`${path}:1:1: HTML cannot be imported as a module.`);
    const module: GraphModule = {
      path,
      kind: descriptor.kind,
      code: '',
      dependencies: Object.create(null) as Record<string, string>,
      runtimeDependencies: [],
    };
    modules.set(path, module);
    if (descriptor.kind === 'asset') {
      identity.push([path, 'asset', descriptor.sha256, descriptor.media_type]);
      return;
    }
    if (descriptor.kind === 'css') return;
    if (input.encoding !== 'utf8') throw new Error(`${path}:1:1: Source module must be UTF-8.`);
    const file = ts.createSourceFile(
      path,
      input.text,
      ts.ScriptTarget.ES2022,
      true,
      descriptor.kind === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const resolved: string[] = [];
    const inspect = (node: ts.Node, functionDepth: number) => {
      if (ts.isImportEqualsDeclaration(node)) fail(file, node, 'import= is not supported.');
      if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword)
        fail(file, node, 'import.meta is not supported.');
      if (
        (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier)) &&
        functionDepth === 0
      )
        fail(file, node, 'Top-level await is not supported.');
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      )
        fail(file, node, 'Dynamic imports and require() are not supported.');
      if (ts.isImportTypeNode(node)) {
        if (!ts.isLiteralTypeNode(node.argument) || !ts.isStringLiteral(node.argument.literal))
          fail(file, node, 'Type import must use a static string.');
        const name = node.argument.literal.text;
        if (!publicNames.includes(name)) {
          let target: string;
          try {
            target = resolveSuitePath(path, name, files);
          } catch (error) {
            fail(file, node, String(error instanceof Error ? error.message : error));
          }
          resolved.push(target);
          module.dependencies[name] = target;
        }
      }
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        const specifier = node.moduleSpecifier;
        if (!ts.isStringLiteral(specifier))
          fail(file, specifier, 'Module specifier must be a string.');
        const name = specifier.text;
        if (publicNames.includes(name)) module.dependencies[name] = name;
        else {
          let target: string;
          try {
            target = resolveSuitePath(path, name, files);
          } catch (e) {
            fail(file, specifier, String(e instanceof Error ? e.message : e));
          }
          const kind = descriptors.get(target)!.kind;
          if (kind === 'html') fail(file, specifier, 'HTML cannot be imported as a module.');
          if (kind === 'css' && (!ts.isImportDeclaration(node) || node.importClause))
            fail(file, specifier, 'CSS supports side-effect imports only.');
          module.dependencies[name] = target;
          resolved.push(target);
          const typeOnly = ts.isImportDeclaration(node)
            ? node.importClause?.isTypeOnly
            : node.isTypeOnly;
          if (!typeOnly) module.runtimeDependencies.push(target);
        }
      }
      const depth = functionDepth + (ts.isFunctionLike(node) ? 1 : 0);
      ts.forEachChild(node, (child) => inspect(child, depth));
    };
    inspect(file, 0);
    const result = ts.transpileModule(input.text, {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        isolatedModules: true,
      },
      transformers: transform ? { before: transform.before(path) } : undefined,
    });
    const error = result.diagnostics?.find((d) => d.category === ts.DiagnosticCategory.Error);
    if (error) {
      const pos = file.getLineAndCharacterOfPosition(error.start ?? 0);
      throw new Error(
        `${path}:${pos.line + 1}:${pos.character + 1}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`,
      );
    }
    module.code = result.outputText;
    // The automatic JSX runtime is the same public runtime object as application JSX.
    module.dependencies['react/jsx-runtime'] = 'react/jsx-runtime';
    identity.push([path, input.text, module.dependencies]);
    for (const target of resolved) visit(target);
  };
  const uniqueEntries = [...new Set(entries)];
  for (const entry of uniqueEntries) visit(entry);
  identity.sort((a, b) => compareCodePoints((a as string[])[0], (b as string[])[0]));
  return createModuleGraph(modules, uniqueEntries,
    canonicalSuiteJson([transform?.cacheKey ?? '', identity, uniqueEntries]));
}
