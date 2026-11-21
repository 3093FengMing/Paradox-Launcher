import * as ts from 'typescript';

/** Imported origins survive const aliases and static destructuring, but never mutable bindings. */
export interface Origin {
  name: string;
  module: string;
  namespace: boolean;
}
export interface BindingScope {
  bindings: Map<string, Binding>;
  parent: BindingScope | null;
}
interface AliasBinding {
  expression: ts.Expression;
  scope: BindingScope;
  path: readonly string[];
}
type Binding = Origin | AliasBinding | null;
export function unwrap(node: ts.Expression): ts.Expression {
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

/** Static destructuring keys retain provenance; defaults and rest bindings do not. */
function bindingKey(pattern: ts.BindingPattern, index: number, element: ts.BindingElement): string | null {
  if (ts.isArrayBindingPattern(pattern)) return String(index);
  const property = element.propertyName ?? (ts.isIdentifier(element.name) ? element.name : undefined);
  return property && (ts.isIdentifier(property) || ts.isStringLiteral(property) || ts.isNumericLiteral(property)) ? property.text : null;
}
function bindName(name: ts.BindingName, value: AliasBinding | null, scope: BindingScope): void {
  if (ts.isIdentifier(name)) { scope.bindings.set(name.text, value); return; }
  for (const [index, element] of name.elements.entries()) {
    if (!ts.isBindingElement(element)) continue;
    const key = bindingKey(name, index, element);
    const alias = value && key !== null && !element.dotDotDotToken && !element.initializer
      ? { ...value, path: [...value.path, key] } : null;
    bindName(element.name, alias, scope);
  }
}
/** Imports are indexed once at scope entry, so a later declaration can shadow an earlier use. */
function bindImport(statement: ts.ImportDeclaration, scope: BindingScope): void {
  if (!ts.isStringLiteral(statement.moduleSpecifier)) return;
  const module = statement.moduleSpecifier.text, clause = statement.importClause;
  if (clause?.name) scope.bindings.set(clause.name.text, { name: clause.name.text, module, namespace: false });
  const bindings = clause?.namedBindings;
  if (!bindings) return;
  if (ts.isNamespaceImport(bindings)) {
    scope.bindings.set(bindings.name.text, { name: '*', module, namespace: true }); return;
  }
  for (const item of bindings.elements)
    scope.bindings.set(item.name.text, { name: item.propertyName?.text ?? item.name.text, module, namespace: false });
}
function bindStatement(statement: ts.Statement, scope: BindingScope): void {
  if (ts.isImportDeclaration(statement)) { bindImport(statement, scope); return; }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      const alias = statement.declarationList.flags & ts.NodeFlags.Const && declaration.initializer
        ? { expression: declaration.initializer, scope, path: [] } : null;
      bindName(declaration.name, alias, scope);
    }
    return;
  }
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name)
    scope.bindings.set(statement.name.text, null);
}
function scopeFor(node: ts.Node, parent: BindingScope | null): BindingScope {
  const scope: BindingScope = { bindings: new Map(), parent };
  if (ts.isFunctionLike(node)) for (const parameter of node.parameters) bindName(parameter.name, null, scope);
  const statements = ts.isSourceFile(node) || ts.isBlock(node) ? node.statements : [];
  for (const statement of statements) bindStatement(statement, scope);
  return scope;
}
function member(base: Origin | null, name: string | null): Origin | null {
  if (!name || (!base && name !== 'Provider' && name !== 'Consumer')) return null;
  return { name, module: base?.module ?? '', namespace: false };
}
function lexicalBinding(name: string, scope: BindingScope | null): Binding | undefined {
  for (let lexical = scope; lexical; lexical = lexical.parent)
    if (lexical.bindings.has(name)) return lexical.bindings.get(name);
  return undefined;
}
/** Alias cycles and dynamic property access erase provenance rather than guessing an origin. */
function expressionOrigin(expression: ts.Expression, scope: BindingScope | null, seen = new Set<Binding>()): Origin | null {
  const node = unwrap(expression);
  if (ts.isIdentifier(node)) {
    const binding = lexicalBinding(node.text, scope);
    if (!binding || seen.has(binding)) return null;
    seen.add(binding);
    if ('module' in binding) return binding;
    let result = expressionOrigin(binding.expression, binding.scope, seen);
    for (const property of binding.path) result = member(result, property);
    return result;
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const base = expressionOrigin(node.expression, scope, seen);
    const name = ts.isPropertyAccessExpression(node) ? node.name.text
      : ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : null;
    return member(base, name);
  }
  if (!ts.isCallExpression(node)) return null;
  const called = expressionOrigin(node.expression, scope, seen);
  return called?.module === 'react' && called.name === 'createContext'
    ? { name: 'Provider', module: 'react', namespace: false } : null;
}
/** Each transformer owns its lexical stack; no provenance escapes between source files. */
export function createBindingResolver() {
  const scopes: BindingScope[] = [];
  return {
    origin(expression: ts.Expression) { return expressionOrigin(expression, scopes.at(-1) ?? null); },
    enter(node: ts.Node) { scopes.push(scopeFor(node, scopes.at(-1) ?? null)); },
    leave() { scopes.pop(); },
  };
}
