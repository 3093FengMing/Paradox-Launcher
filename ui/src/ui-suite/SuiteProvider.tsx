/** @jsxImportSource react */
import {
  Component,
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ComponentType, ReactNode, Ref } from 'react';
import { useLauncherActions, useLauncherSnapshot } from '../launcher/public/context';
import { useActiveRouteRegistry } from '../launcher/routeRegistry';
import { UiFoundationProvider, useUiFoundation } from '../ui-foundation/environment';
import { UiEditorRendererContext, useSuiteRootStyles } from '../ui-editor/host';
import { useSuiteActivation, useUiEditorController } from '../ui-editor/controller';
import { UiRuntimeRoot, UiRuntimeView } from '../customization/runtime';
import { UiOwnerContext, UiViewContext, UiBusinessContext } from '../customization/context';
import {
  getSuiteStyleRoot,
  listOwners,
  publishUiDefinitions,
  resolveSelector,
  subscribeOwners,
} from '../customization/ownership';
import { selectorMatches, sameSelector } from '../customization/selectors';
import { attachSuiteStyles, SuiteInlineStyleContext, suiteInlineStyleResolver } from './prepared';
import type { PreparedUiSuite, PreparedSuiteRuntime, UiViewProps } from './prepared';
import type { UiViewPublication } from '../customization/ownership';
import { SuiteViewContext } from './View';
import type { UiViewOptions } from './View';

interface Layer {
  layerId: string;
  prepared: PreparedUiSuite;
}
interface Runtime {
  layers: readonly Layer[];
  trusted: Layer;
}
interface Candidate {
  layer: Layer;
  Component: ComponentType<UiViewProps>;
  group: string;
  publication: UiViewPublication;
}
type CandidateOptions = React.ComponentProps<typeof CandidateView>;
const OriginalContext = createContext<readonly { token: object; data: CandidateOptions }[]>([]);
const RuntimeContext = createContext<Runtime | null>(null);
const OwningLayerContext = createContext<Layer | null>(null);
const ProtectedContext = createContext(false);
function OriginalCallContext({ originals, token, data, children }: {
  originals: React.ContextType<typeof OriginalContext>;
  token: object;
  data: CandidateOptions;
  children: ReactNode;
}) {
  const frame = useContext(UiOwnerContext);
  // A continuation is the same UiView call, not a second repeated call. Keep
  // its logical owner while each candidate supplies its own source/style layer.
  return <OriginalContext.Provider value={[...originals, { token, data: { ...data, originalFrame: frame, ownsViewBoundary: false } }]}>{children}</OriginalContext.Provider>;
}
function composeOriginalRefs(original: unknown, forwarded: unknown): unknown {
  if (!original || original === forwarded) return forwarded ?? original;
  if (!forwarded) return original;
  const refs = [original, forwarded] as Ref<unknown>[];
  return (node: unknown) => {
    const cleanups = refs.map((ref) => {
      if (typeof ref === 'function') return ref(node);
      if (ref) ref.current = node;
      return undefined;
    });
    return () =>
      refs.forEach((ref, index) => {
        const cleanup = cleanups[index];
        if (typeof cleanup === 'function') cleanup();
        else if (typeof ref === 'function') ref(null);
        else if (ref) ref.current = null;
      });
  };
}
function rich(prepared: PreparedUiSuite): PreparedSuiteRuntime | null {
  return 'viewMetadata' in prepared && 'targetBindings' in prepared && 'styleGroups' in prepared
    ? (prepared as PreparedSuiteRuntime)
    : null;
}
const emptyOwners = Object.freeze([]);
const getEmptyOwners = () => emptyOwners;
const skipOwners = () => () => {};
class ViewBoundary extends Component<
  { identity: unknown; fallback: ReactNode; children: ReactNode; onError?: (error: unknown) => void },
  { identity: unknown; failed: boolean }
> {
  state = { identity: this.props.identity, failed: false };
  static getDerivedStateFromProps(props: { identity: unknown }, state: { identity: unknown }) {
    return props.identity !== state.identity ? { identity: props.identity, failed: false } : null;
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    try {
      this.props.onError?.(error);
    } catch (reportError) {
      console.error('UI render feedback failed', reportError);
    }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function RecoveryTrigger() {
  const controller = useUiEditorController();
  useEffect(() => {
    if (!controller.isRecoveryVisible()) controller.recovery.disable();
  }, [controller]);
  return null;
}
function CandidateView({
  candidates,
  index,
  options,
  snapshot,
  actions,
  base,
  originalFrame,
  originalView,
  originalStyle,
  originalLayer,
  originalBusiness,
  ownsViewBoundary = true,
}: {
  candidates: readonly Candidate[];
  index: number;
  options: UiViewOptions;
  snapshot: UiViewProps['snapshot'];
  actions: UiViewProps['actions'];
  base: ComponentType<Record<string, unknown>> | undefined;
  originalFrame: React.ContextType<typeof UiOwnerContext>;
  originalView: React.ContextType<typeof UiViewContext>;
  originalStyle: React.ContextType<typeof SuiteInlineStyleContext>;
  originalLayer: Layer | null;
  originalBusiness: React.ContextType<typeof UiBusinessContext>;
  ownsViewBoundary?: boolean;
}): React.JSX.Element {
  const originals = useContext(OriginalContext),
    [token] = useState(() => ({})),
    controller = useUiEditorController();
  const OriginalAdapter = useMemo(
    () =>
      function OwnedOriginal(forwarded: Record<string, unknown>) {
        const stack = useContext(OriginalContext),
          current = stack.find((row) => row.token === token)?.data;
        const ref = useMemo(
          () => composeOriginalRefs(current?.options.props?.ref, forwarded.ref),
          [current?.options.props?.ref, forwarded.ref],
        );
        if (!current) return null;
        return (
          <UiOwnerContext.Provider value={current.originalFrame}>
            <UiBusinessContext.Provider value={current.originalBusiness}>
              <UiViewContext.Provider value={current.originalView}>
                <SuiteInlineStyleContext.Provider value={current.originalStyle}>
                  <OwningLayerContext.Provider value={current.originalLayer}>
                    <CandidateView
                      {...current}
                      index={current.index + 1}
                      options={{
                        ...current.options,
                        props: { ...current.options.props, ...forwarded, ...(ref ? { ref } : {}) },
                        children: Object.hasOwn(forwarded, 'children')
                          ? (forwarded.children as ReactNode)
                          : current.options.children,
                      }}
                    />
                  </OwningLayerContext.Provider>
                </SuiteInlineStyleContext.Provider>
              </UiViewContext.Provider>
            </UiBusinessContext.Provider>
          </UiOwnerContext.Provider>
        );
      },
    [token],
  );
  const current = {
    candidates,
    index,
    options,
    snapshot,
    actions,
    base,
    originalFrame,
    originalView,
    originalStyle,
    originalLayer,
    originalBusiness,
    ownsViewBoundary,
  };
  const fallback = <CandidateView {...current} index={index + 1} />;
  const candidate = candidates[index];
  if (!candidate) {
    if (!base) return <RecoveryTrigger />;
    return (
      <ViewBoundary identity={base} fallback={<RecoveryTrigger />} onError={(error) => controller.reportRenderError(error, options.id)}>
        <OwningLayerContext.Provider value={originalLayer}>
          <UiOwnerContext.Provider value={originalFrame}>
            <UiBusinessContext.Provider value={originalBusiness}>
              <UiViewContext.Provider value={originalView}>
                <SuiteInlineStyleContext.Provider value={originalStyle}>
                  {createElement(base, {
                    ...options.props,
                    ...(options.children === undefined ? {} : { children: options.children }),
                  })}
                </SuiteInlineStyleContext.Provider>
              </UiViewContext.Provider>
            </UiBusinessContext.Provider>
          </UiOwnerContext.Provider>
        </OwningLayerContext.Provider>
      </ViewBoundary>
    );
  }
  const prepared = rich(candidate.layer.prepared);
  return (
    <ViewBoundary identity={candidate.Component} fallback={fallback} onError={(error) => controller.reportRenderError(error, candidate.publication.sourcePath ?? options.id)}>
      <OwningLayerContext.Provider value={candidate.layer}>
        <SuiteInlineStyleContext.Provider
          value={prepared ? suiteInlineStyleResolver(prepared, candidate.group) : null}
        >
          <UiRuntimeView publication={candidate.publication} ownsBoundary={ownsViewBoundary}>
            <OriginalCallContext originals={originals} token={token} data={current}>
              {createElement(candidate.Component, {
                snapshot,
                actions,
                props: Object.freeze({ ...options.props }),
                children:
                  options.children === undefined
                    ? (options.props?.children as ReactNode)
                    : options.children,
                Original: OriginalAdapter,
              })}
            </OriginalCallContext>
          </UiRuntimeView>
        </SuiteInlineStyleContext.Provider>
      </OwningLayerContext.Provider>
    </ViewBoundary>
  );
}
function ResolveView(options: UiViewOptions): React.JSX.Element {
  const runtime = useContext(RuntimeContext)!;
  const owner = useContext(UiOwnerContext),
    view = useContext(UiViewContext),
    style = useContext(SuiteInlineStyleContext),
    owningLayer = useContext(OwningLayerContext);
  const business = useContext(UiBusinessContext);
  const protectedInherited = useContext(ProtectedContext),
    environment = useUiFoundation();
  const protectedMode = !!options.protectedMode || protectedInherited || environment.protectedMode;
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions();
  const candidates: Candidate[] = [];
  // UiRuntimeView registers this exact final call. Match a picked view against
  // that complete locator; automatic subject aliases retain their callsite frame.
  const viewLocator = { ...owner.locator, calls: [...owner.locator.calls, { site: `view:${options.id}`, key: null }], business };
  const layers = protectedMode
    ? [runtime.trusted]
    : runtime.layers.slice(Math.max(0, owningLayer ? runtime.layers.indexOf(owningLayer) : 0));
  // Only a matching structural position override depends on owner safety.
  // Keep the Hook unconditional as suites/locators change, but avoid subscribing
  // native and broad surfaces to every unrelated registry publication.
  const needsOwners = layers.some((layer) => rich(layer.prepared)?.targetBindings.some(
    (binding) => binding.Component && binding.selector.kind === 'position' &&
      [options.id, ...(options.targets ?? [])].some((target) =>
        selectorMatches(binding.selector, target, owner.locator) ||
        (target === options.id && selectorMatches(binding.selector, target, viewLocator))),
  ));
  useSyncExternalStore(needsOwners ? subscribeOwners : skipOwners,
    needsOwners ? listOwners : getEmptyOwners, needsOwners ? listOwners : getEmptyOwners);
  for (const layer of layers) {
    const prepared = rich(layer.prepared),
      metadata = prepared?.viewMetadata.get(options.id);
    if (prepared) {
      const matching = prepared.targetBindings.filter(
        (binding) =>
          binding.Component &&
          [options.id, ...(options.targets ?? [])].some((target) =>
            selectorMatches(binding.selector, target, owner.locator) ||
            (target === options.id && selectorMatches(binding.selector, target, viewLocator)),
          ) &&
          (binding.selector.kind !== 'position' ||
            !['unsupported', 'ambiguous'].includes(resolveSelector(binding.selector).status)),
      );
      // Position > business > type. CSS-only bindings never hide structural candidates.
      matching.sort(
        (a, b) =>
          ['position', 'business', 'type'].indexOf(a.selector.kind) -
          ['position', 'business', 'type'].indexOf(b.selector.kind),
      );
      for (const binding of matching) {
        const definition = prepared.sourceDefinitions.find(
          (item) =>
            item.selector &&
            sameSelector(item.selector, binding.selector) &&
            item.type === 'override',
        );
        candidates.push({
          layer,
          Component: binding.Component!,
          group: binding.styleGroup,
          publication: {
            viewId: options.id,
            sourcePath: definition?.sourcePath ?? null,
            routeId: view?.routeId ?? null,
            layerId: layer.layerId,
            nameKey: definition?.nameKey ?? null,
          },
        });
      }
    }
    const Component = layer.prepared.views.get(options.id);
    if (Component)
      candidates.push({
        layer,
        Component,
        group: 'global',
        publication: {
          viewId: options.id,
          sourcePath: metadata?.sourcePath ?? null,
          routeId: metadata?.routeId ?? null,
          layerId: layer.layerId,
          nameKey: metadata?.nameKey ?? null,
        },
      });
  }
  return (
    <ProtectedContext.Provider value={protectedMode}>
      <CandidateView
        candidates={candidates}
        index={0}
        options={options}
        snapshot={snapshot as unknown as UiViewProps['snapshot']}
        actions={actions}
        base={options.Original}
        originalFrame={owner}
        originalView={view}
        originalStyle={style}
        originalLayer={owningLayer}
        originalBusiness={business}
      />
    </ProtectedContext.Provider>
  );
}
/** Borrowed PreparedUiSuite: this consumer releases only its own registry/style leases. */
export function SuiteProvider({
  fallback,
  children,
}: {
  fallback: PreparedUiSuite;
  children: ReactNode;
}): React.JSX.Element {
  const activation = useSuiteActivation(),
    environment = useUiFoundation(),
    registry = useActiveRouteRegistry();
  const bootstrap = useMemo<Layer>(
    () => ({ layerId: 'trusted.bootstrap', prepared: fallback }),
    [fallback],
  );
  const runtime = useMemo<Runtime>(
    () =>
      activation
        ? {
            layers: [
              ...new Set(
                [activation.primary, activation.parent, activation.trusted].filter(
                  (layer) => layer !== null,
                ),
              ),
            ] as Layer[],
            trusted: activation.trusted,
          }
        : { layers: [bootstrap], trusted: bootstrap },
    [activation, bootstrap],
  );
  useSuiteRootStyles(
    typeof document === 'undefined' ? null : document,
    'launcher.main',
    activation,
  );
  useEffect(() => {
    if (activation) return;
    const definitions = rich(fallback)?.sourceDefinitions;
    const release = definitions
      ? publishUiDefinitions({ key: 'suite:bootstrap', definitions })
      : () => {};
    const cleanups: (() => void)[] = [];
    let signature = '';
    const refresh = () => {
      const snapshot = getSuiteStyleRoot('launcher.main', bootstrap.layerId),
        next = JSON.stringify([...snapshot.viewIds].sort());
      if (signature === next) {
        snapshot.dispose();
        return;
      }
      signature = next;
      cleanups.splice(0).forEach((dispose) => dispose());
      const detach = attachSuiteStyles(document, fallback, snapshot);
      cleanups.push(() => {
        detach();
        snapshot.dispose();
      });
    };
    refresh();
    const unsubscribe = subscribeOwners(refresh);
    return () => {
      unsubscribe();
      cleanups.splice(0).forEach((dispose) => dispose());
      release();
    };
  }, [fallback, activation, bootstrap.layerId]);
  useEffect(() => {
    if (!activation) return;
    registry.setActiveRouteRegistry(runtime.layers[0].prepared.routes);
  }, [registry, runtime, activation]);
  const renderView = useCallback(
    (
      id: string,
      props: Record<string, unknown>,
      Original: ComponentType<Record<string, unknown>>,
    ) => createElement(ResolveView, { id, props, Original }),
    [],
  );
  const editor = useCallback(
    ({ protectedMode }: { protectedMode: boolean }) => (
      <BootstrapEditorStyles fallback={fallback} active={!activation}>
        <ResolveView id="tool.editor" protectedMode={protectedMode} />
      </BootstrapEditorStyles>
    ),
    [fallback, activation],
  );
  return (
    <RuntimeContext.Provider value={runtime}>
      <SuiteViewContext.Provider value={ResolveView}>
        <UiEditorRendererContext.Provider value={editor}>
          <UiFoundationProvider value={{ ...environment, renderView }}>
            <UiRuntimeRoot id="launcher.main">{children}</UiRuntimeRoot>
          </UiFoundationProvider>
        </UiEditorRendererContext.Provider>
      </SuiteViewContext.Provider>
    </RuntimeContext.Provider>
  );
}
function BootstrapEditorStyles({
  fallback,
  active,
  children,
}: {
  fallback: PreparedUiSuite;
  active: boolean;
  children: ReactNode;
}) {
  const environment = useUiFoundation();
  useEffect(() => {
    const root = environment.portalContainer;
    if (!active || !(root instanceof ShadowRoot)) return;
    let signature = '';
    const cleanups: (() => void)[] = [];
    const refresh = () => {
      const snapshot = getSuiteStyleRoot('launcher.editor', 'trusted.bootstrap'),
        next = JSON.stringify([...snapshot.viewIds].sort());
      if (signature === next) {
        snapshot.dispose();
        return;
      }
      signature = next;
      cleanups.splice(0).forEach((dispose) => dispose());
      const detach = attachSuiteStyles(root, fallback, snapshot);
      cleanups.push(() => {
        detach();
        snapshot.dispose();
      });
    };
    refresh();
    const unsubscribe = subscribeOwners(refresh);
    return () => {
      unsubscribe();
      cleanups.splice(0).forEach((dispose) => dispose());
    };
  }, [fallback, active, environment.portalContainer]);
  return children;
}
