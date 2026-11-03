import {
  createContext,
  createElement,
  useContext,
  useState,
  useMemo,
} from 'react';
import type { ComponentType } from 'react';
import {
  BypassContext,
  IdentityContext,
  ScopeContext,
  targetRegistry,
  UiOwnerContext,
  UiBusinessContext,
  UiViewContext,
} from './context';
import { identityToken, safeTargetIdentity } from './identity';
import { UiOwnerBoundary } from './runtime';
import { UiIdentity } from '../ui-foundation/Identity';
import { SuiteInlineStyleContext } from '../ui-suite/prepared';
import { SuiteViewContext } from '../ui-suite/View';

const OriginalContext = createContext<
  Array<{
    owner: string;
    Original: ComponentType<Record<string, unknown>>;
    bypass: Set<string>;
    frame: React.ContextType<typeof UiOwnerContext>;
    business: React.ContextType<typeof UiBusinessContext>;
    view: React.ContextType<typeof UiViewContext>;
    style: React.ContextType<typeof SuiteInlineStyleContext>;
  }>
>([]);

export function CustomSurface({
  target,
  Original,
  originalProps,
  extraTargets = [],
}: {
  target: string;
  Original: ComponentType<Record<string, unknown>>;
  originalProps: Record<string, unknown>;
  extraTargets?: string[];
}) {
  const SuiteRenderer = useContext(SuiteViewContext);
  const originals = useContext(OriginalContext);
  const [owner] = useState(() => `original-${++nextOriginal}`);
  const frame = useContext(UiOwnerContext);
  const business = useContext(UiBusinessContext);
  const view = useContext(UiViewContext);
  const style = useContext(SuiteInlineStyleContext);
  const OriginalAdapter = useMemo(
    () =>
      function OwnedOriginal(props: Record<string, unknown>) {
        const stack = useContext(OriginalContext);
        const original = stack.find((entry) => entry.owner === owner);
        if (!original) return null;
        return createElement(
          BypassContext.Provider,
          { value: original.bypass },
          createElement(
            UiOwnerContext.Provider,
            { value: original.frame },
            createElement(
              UiBusinessContext.Provider,
              { value: original.business },
              createElement(
                UiViewContext.Provider,
                { value: original.view },
                createElement(
                  SuiteInlineStyleContext.Provider,
                  { value: original.style },
                  createElement(original.Original, props),
                ),
              ),
            ),
          ),
        );
      },
    [owner],
  );
  const parentScopes = useContext(ScopeContext);
  const bypass = useContext(BypassContext);
  const scopes = [...parentScopes, target, ...extraTargets];
  const candidates = [target, ...extraTargets].filter((id) => !bypass.has(id));
  const original = createElement(Original, originalProps);
  const blocked = new Set([...bypass, ...candidates]);
  if (SuiteRenderer) {
    return createElement(
      ScopeContext.Provider,
      { value: scopes },
      candidates.length
        ? createElement(
            OriginalContext.Provider,
            { value: [...originals, { owner, Original, bypass, frame, business, view, style }] },
            createElement(
              BypassContext.Provider,
              { value: blocked },
              createElement(SuiteRenderer, {
                id: candidates[0],
                targets: candidates.slice(1),
                props: originalProps,
                Original: OriginalAdapter,
              }),
            ),
          )
        : original,
    );
  }
  return createElement(ScopeContext.Provider, { value: scopes }, original);
}
let nextOriginal = 0;

// HOC factory is shared with the compiler's allowed module registry.
// eslint-disable-next-line react-refresh/only-export-components
export function customComponent<P extends object>(
  target: string,
  Original: ComponentType<P>,
): ComponentType<P> {
  targetRegistry.add(target);
  function Customizable(props: P) {
    const parentIdentity = useContext(IdentityContext);
    const values = props as Record<string, unknown>;
    const profile = values.profile as { instance_key?: string } | undefined;
    const account = values.account as { id?: string } | undefined;
    const identity = profile?.instance_key ?? account?.id;
    const frame = useContext(UiOwnerContext);
    const surface = createElement(UiOwnerBoundary, {
      target,
      site: frame.ownerId ? `semantic:${target}` : null,
      children: createElement(CustomSurface, {
        target,
        Original: Original as ComponentType<Record<string, unknown>>,
        originalProps: values,
        extraTargets: identity ? [safeTargetIdentity(target, identity)] : [],
      }),
    });
    return createElement(
      IdentityContext.Provider,
      { value: identity ? identityToken(identity) : parentIdentity },
      identity
        ? createElement(UiIdentity, {
            namespace: profile?.instance_key ? 'profile' : 'account',
            value: identity,
            children: surface,
          })
        : surface,
    );
  }
  Customizable.displayName = `Customizable(${target})`;
  return Customizable;
}
