import { createElement, Fragment } from 'react';
import type { ElementType, ReactNode } from 'react';
import type { CustomProps } from './context';
import { jsx } from './jsx-runtime';
import { prepareSuiteInlineStyle } from './css';
import type { SuiteAssetSource } from './css';
import type { UiViewProps } from '../ui-suite/prepared';
import type { SuiteInlineStyleResolver } from '../ui-suite/prepared';
import { SuiteInlineStyleContext } from '../ui-suite/prepared';
import { instrumentHtmlSites } from './html-sites';

export type HtmlNode =
  | { text: string }
  | {
      tag: string;
      attributes: Record<string, string>;
      children: HtmlNode[];
      style?: Record<string, string>;
    };
const forbidden = new Set(['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'style']);
const urlAttributes = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);

export function parseHtml(source: string): HtmlNode[] {
  const document = new DOMParser().parseFromString(source, 'text/html');
  for (const element of document.querySelectorAll([...forbidden].join(',')))
    throw new Error(
      `HTML: <${element.tagName.toLowerCase()}> is not supported; use TSX for executable components.`,
    );
  const convert = (node: Node): HtmlNode | null => {
    if (node.nodeType === Node.TEXT_NODE) return { text: node.textContent ?? '' };
    if (!(node instanceof Element)) return null;
    const tag = node.tagName.toLowerCase();
    if (forbidden.has(tag))
      throw new Error(`HTML: <${tag}> is not supported; use TSX for executable components.`);
    const attributes: Record<string, string> = {};
    for (const attribute of node.attributes) {
      const name = attribute.name.toLowerCase();
      const url = Array.from(attribute.value)
        .filter((character) => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127)
        .join('');
      const rasterImage =
        tag === 'img' &&
        name === 'src' &&
        /^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(url);
      if (
        name.startsWith('on') ||
        name === 'srcdoc' ||
        (urlAttributes.has(name) && /^(javascript|vbscript|data):/i.test(url) && !rasterImage)
      )
        throw new Error(`HTML: unsupported attribute ${name}. Use data-ui-action for callbacks.`);
      attributes[name] = attribute.value;
    }
    return {
      tag,
      attributes,
      children: Array.from(node.childNodes)
        .map(convert)
        .filter((item): item is HtmlNode => item !== null),
    };
  };
  return Array.from(document.body.childNodes)
    .map(convert)
    .filter((item): item is HtmlNode => item !== null);
}

function property(props: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' && Object.hasOwn(value, key)
          ? (value as Record<string, unknown>)[key]
          : undefined,
      props,
    );
}
function interpolate(text: string, props: Record<string, unknown>) {
  return text.replace(/\{\{([\w.]+)\}\}/g, (_, path: string) => {
    const value = property(props, path);
    return ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '';
  });
}

export function renderHtml(nodes: HtmlNode[], props: CustomProps, scopes: string[]): ReactNode {
  const render = (node: HtmlNode, key: number): ReactNode => {
    if ('text' in node) return interpolate(node.text, props);
    if (node.tag === 'ui-slot') {
      const name = node.attributes.name;
      return createElement(
        Fragment,
        { key },
        name ? (property(props, name) as ReactNode) : createElement(props.Original, props),
      );
    }
    if (node.tag === 'ui-prop') {
      const value = property(props, node.attributes.name ?? '');
      return ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : null;
    }
    const attributes: Record<string, unknown> = { 'data-ui-scope': scopes.join(' ') };
    if ('data-ui-props' in node.attributes) {
      for (const [name, value] of Object.entries(props))
        if (name !== 'Original' && name !== 'children') attributes[name] = value;
    }
    for (const [name, value] of Object.entries(node.attributes)) {
      if (
        name.startsWith('data-ui-') &&
        !['data-ui-target', 'data-ui-node', 'data-ui-site', 'data-ui-source'].includes(name)
      )
        continue;
      const target =
        name === 'class'
          ? 'className'
          : name === 'for'
            ? 'htmlFor'
            : name === 'tabindex'
              ? 'tabIndex'
              : name;
      if (name === 'style') {
        const style: Record<string, string> = {};
        for (const declaration of value.split(';')) {
          const colon = declaration.indexOf(':');
          if (colon < 0) continue;
          const propertyName = declaration.slice(0, colon).trim();
          style[
            propertyName.startsWith('--')
              ? propertyName
              : propertyName.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
          ] = declaration.slice(colon + 1).trim();
        }
        attributes.style = style;
      } else if (
        ['disabled', 'checked', 'multiple', 'required', 'readonly', 'autofocus'].includes(name)
      ) {
        attributes[name === 'readonly' ? 'readOnly' : name === 'autofocus' ? 'autoFocus' : name] =
          value !== 'false';
      } else attributes[target] = interpolate(value, props);
    }
    const action = node.attributes['data-ui-action'];
    if (action) {
      const handler = property(props, action);
      if (typeof handler !== 'function')
        throw new Error(`HTML: callback ${action} is not available on this target.`);
      attributes[node.attributes['data-ui-event'] ?? 'onClick'] = handler;
    }
    const children = node.children.map(render);
    if (children.length) attributes.children = children;
    return jsx(node.tag as ElementType, attributes, node.attributes['data-ui-site'] ?? key);
  };
  return nodes.map(render);
}

const projectedFields = new Set(['event.value', 'event.checked', 'event.valueAsNumber']);
function suiteArguments(text: string): unknown[] {
  const args: unknown = JSON.parse(text);
  if (!Array.isArray(args)) throw new Error('data-ui-args must be a JSON array.');
  const values = args as unknown[];
  for (const arg of values)
    if (arg && typeof arg === 'object' && Object.hasOwn(arg, '$prop')) {
      const path = (arg as Record<string, unknown>).$prop;
      if (
        Object.keys(arg).length !== 1 ||
        typeof path !== 'string' ||
        (!/^(snapshot|props)\.[\w.]+$/.test(path) && !projectedFields.has(path))
      )
        throw new Error(
          'data-ui-args $prop supports snapshot/props paths or event.value, event.checked, event.valueAsNumber only.',
        );
    }
  return values;
}
/** Source-aware suite HTML; only the accepted bundle can supply resource bytes. */
export function parseSuiteHtml(source: string, options: SuiteAssetSource): HtmlNode[] {
  try {
    const nodes = parseHtml(instrumentHtmlSites(source, options.sourcePath).source);
    const visit = (node: HtmlNode) => {
      if ('text' in node) return;
      for (const [name, value] of Object.entries(node.attributes)) {
        if (name === 'style') node.style = prepareSuiteInlineStyle(value, options);
        else if (
          ['src', 'poster', 'xlink:href'].includes(name) ||
          (name === 'href' && !/^(?:https?:|mailto:|tel:)/i.test(value))
        )
          node.attributes[name] = options.resolveAsset(value);
        else if (name === 'srcset')
          node.attributes[name] = value
            .split(',')
            .map((part) => {
              const [url, ...descriptor] = part.trim().split(/\s+/);
              if (descriptor.length > 1 || descriptor.some((d) => !/^\d+(?:\.\d+)?[wx]$/.test(d)))
                throw new Error('Invalid srcset.');
              return [options.resolveAsset(url), ...descriptor].join(' ');
            })
            .join(', ');
      }
      const action = node.attributes['data-ui-action'];
      if (action && !/^(actions|props)\.[\w.]+$/.test(action))
        throw new Error('data-ui-action must be an actions or props callback path.');
      if (node.attributes['data-ui-args'] !== undefined)
        suiteArguments(node.attributes['data-ui-args']);
      const event = node.attributes['data-ui-event'];
      if (event && !/^on[A-Z][a-zA-Z]+$/.test(event))
        throw new Error('data-ui-event must name a React event.');
      node.children.forEach(visit);
    };
    nodes.forEach(visit);
    return nodes;
  } catch (error) {
    throw new Error(
      `${options.sourcePath}:1:1: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
export function renderSuiteHtml(
  nodes: readonly HtmlNode[],
  envelope: UiViewProps,
  resolveStyle?: SuiteInlineStyleResolver | null,
): ReactNode {
  const context = envelope as unknown as Record<string, unknown>;
  const render = (node: HtmlNode, key: number): ReactNode => {
    if ('text' in node) return interpolate(node.text, context);
    if (node.tag === 'ui-slot')
      return createElement(
        Fragment,
        { key },
        node.attributes.name
          ? (property(context, node.attributes.name) as ReactNode)
          : createElement(envelope.Original, {
              ...envelope.props,
              children: envelope.children ?? envelope.props.children,
            }),
      );
    if (node.tag === 'ui-prop') {
      const value = property(context, node.attributes.name ?? '');
      return ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : null;
    }
    const attributes: Record<string, unknown> = {};
    if ('data-ui-props' in node.attributes) Object.assign(attributes, envelope.props);
    for (const [name, value] of Object.entries(node.attributes)) {
      if (
        name.startsWith('data-ui-') &&
        !['data-ui-target', 'data-ui-node', 'data-ui-site', 'data-ui-source'].includes(name)
      )
        continue;
      if (name === 'style') {
        // The actual native JSX DOM path owns descriptor rewriting, including private mirrors.
        attributes.style = node.style;
        continue;
      }
      const target =
        (
          {
            class: 'className',
            for: 'htmlFor',
            tabindex: 'tabIndex',
            readonly: 'readOnly',
            autofocus: 'autoFocus',
            srcset: 'srcSet',
          } as Record<string, string>
        )[name] ?? name;
      attributes[target] = [
        'disabled',
        'checked',
        'multiple',
        'required',
        'readonly',
        'autofocus',
      ].includes(name)
        ? value !== 'false'
        : interpolate(value, context);
    }
    const action = node.attributes['data-ui-action'];
    if (action) {
      const handler = property(context, action);
      if (typeof handler !== 'function')
        throw new Error(`HTML: callback ${action} is not available.`);
      const callback = handler as (...args: unknown[]) => unknown;
      const argsText = node.attributes['data-ui-args'];
      attributes[node.attributes['data-ui-event'] ?? 'onClick'] = (event: unknown) => {
        if (argsText === undefined)
          return action.startsWith('props.') ? callback(event) : callback();
        // Project currentTarget synchronously; the callback receives values, never a DOM reference.
        const args = suiteArguments(argsText).map((arg) => {
          if (!arg || typeof arg !== 'object' || !Object.hasOwn(arg, '$prop')) return arg;
          const path = (arg as { $prop: string }).$prop;
          if (!path.startsWith('event.')) return property(context, path);
          const target = (event as { currentTarget?: Record<string, unknown> })?.currentTarget;
          const field = path.slice(6),
            value = target?.[field];
          if (
            (field === 'value' && typeof value !== 'string') ||
            (field === 'checked' && typeof value !== 'boolean') ||
            (field === 'valueAsNumber' && (typeof value !== 'number' || !Number.isFinite(value)))
          )
            throw new Error(`HTML: ${path} is missing or invalid on the bound currentTarget.`);
          return value;
        });
        return callback(...args);
      };
    }
    if (node.children.length) attributes.children = node.children.map(render);
    return jsx(node.tag as ElementType, attributes, node.attributes['data-ui-site'] ?? key);
  };
  const children = nodes.map(render);
  return resolveStyle
    ? createElement(SuiteInlineStyleContext.Provider, { value: resolveStyle }, children)
    : children;
}
