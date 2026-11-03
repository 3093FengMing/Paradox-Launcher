import { createElement, useContext } from 'react';
import type { ComponentType, ElementType, Key } from 'react';
import { jsx as reactJsx, jsxs as reactJsxs, Fragment } from 'react/jsx-runtime';
import { jsxDEV as reactJsxDEV } from 'react/jsx-dev-runtime';
import { CustomSurface } from './Customizable';
import { UiInteractionContext, DomScopeContext, IdentityContext, ScopeContext, UiOwnerContext } from './context';
import { identityToken, safeTargetIdentity } from './identity';
import { UiOwnerBoundary, useRegisteredRef } from './runtime';
import { SuiteInlineStyleContext } from '../ui-suite/prepared';
import { normalizeUiKey } from './selectors';

export { Fragment };
export type { JSX } from 'react/jsx-runtime';
type NativeProps = Record<string, unknown>;
const nativeComponents = new Map<string, ReturnType<typeof nativeComponent>>();
const libraryComponents = new Map<ElementType, ComponentType<NativeProps>>();

function nativeComponent(tag: string) {
  function Original(props: NativeProps) {
    const ref = useRegisteredRef(props.ref);
    const resolveStyle = useContext(SuiteInlineStyleContext);
    const scopes = useContext(ScopeContext);
    const ancestors = useContext(DomScopeContext);
    const parentIdentity = useContext(IdentityContext);
    const identity = typeof props.__uiIdentity === 'string' ? props.__uiIdentity : parentIdentity;
    const nativeProps = { ...props };
    delete nativeProps.Original;
    delete nativeProps.__uiIdentity;
    delete nativeProps.__uiKey;
    delete nativeProps['data-ui-dom-boundary'];
    delete nativeProps['data-ui-modal-boundary'];
    if (resolveStyle && nativeProps.style && typeof nativeProps.style === 'object')
      nativeProps.style = resolveStyle(nativeProps.style as Record<string, unknown>);
    const node = props['data-ui-node'];
    const instance =
      identity && typeof node === 'string' ? safeTargetIdentity(node, identity) : undefined;
    const roots = props['data-ui-root']
      ? [...scopes]
      : scopes.filter((scope) => !ancestors.includes(scope));
    roots.push(`element.${tag}`);
    const children = nativeProps.children;
    if (children !== undefined && children !== null)
      nativeProps.children = createElement(
        DomScopeContext.Provider,
        { value: scopes },
        createElement(IdentityContext.Provider, { value: identity }, children as React.ReactNode),
      );
    return createElement(tag, {
      ...nativeProps,
      ref,
      'data-ui-scope': scopes.join(' '),
      'data-ui-root-target': [...new Set(roots)].join(' '),
      'data-ui-instance': instance,
    });
  }
  function Native(props: NativeProps) {
    const parentIdentity = useContext(IdentityContext);
    const identity = typeof props.__uiIdentity === 'string' ? props.__uiIdentity : parentIdentity;
    const node = props['data-ui-node'];
    const target = props['data-ui-target'];
    return createElement(UiOwnerBoundary, {
      target: typeof target === 'string' ? target : `element.${tag}`,
      site: typeof props['data-ui-site'] === 'string' ? props['data-ui-site'] : null,
      sourcePath: typeof props['data-ui-source'] === 'string' ? props['data-ui-source'] : null,
      callKey: props.__uiKey,
      children: createElement(CustomSurface, {
        target: `element.${tag}`,
        Original,
        originalProps: props,
        extraTargets: [
          ...(typeof target === 'string' ? [target] : []),
          ...(typeof node === 'string'
            ? [node, ...(identity ? [safeTargetIdentity(node, identity)] : [])]
            : []),
        ],
      }),
    });
  }
  Native.uiTag = tag;
  Native.displayName = `CustomElement(${tag})`;
  return Native;
}
function intercept(type: ElementType, props: NativeProps): ElementType {
  if (type === Fragment) return FragmentOwner;
  if (typeof type !== 'string') {
    if (
      (typeof props['data-ui-node'] !== 'string' && typeof props['data-ui-site'] !== 'string') ||
      typeof type === 'symbol'
    )
      return type;
    let Customized = libraryComponents.get(type);
    if (!Customized) {
      function Original(values: NativeProps) {
        const ref = useRegisteredRef(values.ref);
        const resolveStyle = useContext(SuiteInlineStyleContext);
        const { editing } = useContext(UiInteractionContext);
        const owner = useContext(UiOwnerContext);
        const scopes = useContext(ScopeContext);
        const ancestors = useContext(DomScopeContext);
        const forwarded = { ...values };
        const domBoundary = forwarded['data-ui-dom-boundary'] === true;
        const modalBoundary = forwarded['data-ui-modal-boundary'] === true;
        delete forwarded.Original;
        delete forwarded.__uiIdentity;
        delete forwarded.__uiKey;
        delete forwarded['data-ui-dom-boundary'];
        delete forwarded['data-ui-modal-boundary'];
        if (domBoundary && resolveStyle && forwarded.style && typeof forwarded.style === 'object')
          forwarded.style = resolveStyle(forwarded.style as Record<string, unknown>);
        if (modalBoundary && editing && owner.locator.renderRoot === 'launcher.main') {
          forwarded.modal = false;
          forwarded.disablePointerDismissal = true;
          const notify =
            typeof forwarded.onOpenChange === 'function'
              ? (forwarded.onOpenChange as (open: boolean, ...args: unknown[]) => unknown)
              : undefined;
          forwarded.onOpenChange = (open: boolean, ...args: unknown[]) => {
            if (!open) {
              const details = args[0];
              if (
                details &&
                typeof details === 'object' &&
                'cancel' in details &&
                typeof details.cancel === 'function'
              )
                (details.cancel as () => void).call(details);
              return;
            }
            notify?.(open, ...args);
          };
        }
        if (domBoundary && forwarded.children !== undefined && forwarded.children !== null)
          forwarded.children = createElement(
            DomScopeContext.Provider,
            { value: scopes },
            forwarded.children as React.ReactNode,
          );
        return createElement(type, {
          ...forwarded,
          ref,
          'data-ui-scope': scopes.join(' '),
          'data-ui-root-target': scopes.filter((scope) => !ancestors.includes(scope)).join(' '),
        });
      }
      Customized = function LibraryElement(values: NativeProps) {
        const parentIdentity = useContext(IdentityContext);
        const identity =
          typeof values.__uiIdentity === 'string' ? values.__uiIdentity : parentIdentity;
        const target =
          typeof values['data-ui-target'] === 'string'
            ? values['data-ui-target']
            : typeof values['data-ui-node'] === 'string'
              ? values['data-ui-node']
              : 'component';
        return createElement(UiOwnerBoundary, {
          target,
          site: typeof values['data-ui-site'] === 'string' ? values['data-ui-site'] : null,
          sourcePath:
            typeof values['data-ui-source'] === 'string' ? values['data-ui-source'] : null,
          callKey: values.__uiKey,
          children: createElement(
            IdentityContext.Provider,
            { value: identity },
            createElement(CustomSurface, {
              target,
              Original,
              originalProps: values,
              extraTargets: identity ? [safeTargetIdentity(target, identity)] : [],
            }),
          ),
        });
      };
      libraryComponents.set(type, Customized);
    }
    return Customized;
  }
  let Native = nativeComponents.get(type);
  if (!Native) {
    Native = nativeComponent(type);
    nativeComponents.set(type, Native);
  }
  return Native;
}
function FragmentOwner(props: NativeProps) {
  return createElement(UiOwnerBoundary, {
    target: 'fragment',
    site: typeof props['data-ui-site'] === 'string' ? props['data-ui-site'] : null,
    sourcePath: typeof props['data-ui-source'] === 'string' ? props['data-ui-source'] : null,
    callKey: props.__uiKey,
    children: props.children as React.ReactNode,
  });
}
// These functions implement the automatic JSX runtime protocol.
// eslint-disable-next-line react-refresh/only-export-components
export function jsx(type: ElementType, props: NativeProps, key?: Key) {
  return reactJsx(
    intercept(type, props),
    normalizeUiKey(key) !== null
      ? {
          ...props,
          __uiKey: normalizeUiKey(key),
          __uiIdentity: identityToken(normalizeUiKey(key)!),
        }
      : props,
    key,
  );
}
// eslint-disable-next-line react-refresh/only-export-components
export function jsxs(type: ElementType, props: NativeProps, key?: Key) {
  return reactJsxs(
    intercept(type, props),
    normalizeUiKey(key) !== null
      ? {
          ...props,
          __uiKey: normalizeUiKey(key),
          __uiIdentity: identityToken(normalizeUiKey(key)!),
        }
      : props,
    key,
  );
}
// eslint-disable-next-line react-refresh/only-export-components
export function jsxDEV(
  type: ElementType,
  props: NativeProps,
  key: Key | undefined,
  isStaticChildren: boolean,
  source: Parameters<typeof reactJsxDEV>[4],
  self: unknown,
) {
  const normalized = normalizeUiKey(key);
  return reactJsxDEV(
    intercept(type, props),
    normalized === null
      ? props
      : { ...props, __uiKey: normalized, __uiIdentity: identityToken(normalized) },
    key,
    isStaticChildren,
    source,
    self,
  );
}
