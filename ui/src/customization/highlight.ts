import type { UiSelector } from '../ui-suite/model';
import { getOwner, resolveSelector, subscribeOwners } from './ownership';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import InspectorOverlay from './InspectorOverlay';

/** Cross ShadowRoot boundaries; normal editor controls remain inspectable. */
export function isInspectorArtifact(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute('data-ui-inspector-artifact') || current.id === 'paradox-suite-recovery') return true;
    const root: Node = current.getRootNode();
    current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return false;
}

/** Portal hosts can have zero height while their fixed children remain visible. */
export function getCurrentRootRects(root: Element): readonly DOMRectReadOnly[] {
  const view = root.ownerDocument.defaultView;
  if (!view || !root.isConnected || isInspectorArtifact(root)) return [];
  const visible = (element: Element) => {
    const style = view.getComputedStyle(element);
    return !isInspectorArtifact(element) && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0';
  };
  if (!visible(root)) return [];
  const own = [...root.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
  if (own.length) return own;
  return [...root.querySelectorAll('*')].filter(visible).flatMap(element => [...element.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0));
}

/** Shared noninteractive range machinery. Task 3 may keep this lease for hover. */
export function showTargetRanges(ownerIds: readonly string[], doc: Document = document): () => void {
  const renderer = createRoot(doc.createElement('div'));
  const view = doc.defaultView!;
  let frame = 0, disposed = false;
  let roots = new Set<Element>(), scrollRoots = new Set<Element | ShadowRoot>();
  const observer = new ResizeObserver(() => schedule());
  const mutations = new MutationObserver(() => schedule());
  const syncRoots = () => {
    const next = new Set(resolveOwners().flatMap(owner => [...owner.roots]).filter(root => root.isConnected && !isInspectorArtifact(root)));
    const scroll = new Set<Element | ShadowRoot>();
    for (const root of next) {
      scroll.add(root);
      const tree = root.getRootNode(); if (tree instanceof ShadowRoot) scroll.add(tree);
      for (const element of [root, ...root.querySelectorAll('*')]) if (element.shadowRoot && !isInspectorArtifact(element)) scroll.add(element.shadowRoot);
    }
    for (const root of scrollRoots) if (!scroll.has(root)) root.removeEventListener('scroll', schedule, true);
    for (const root of scroll) if (!scrollRoots.has(root)) root.addEventListener('scroll', schedule, true);
    scrollRoots = scroll;
    if (next.size === roots.size && [...next].every(root => roots.has(root))) return;
    observer.disconnect(); mutations.disconnect(); roots = next;
    const ancestry = new Set<Element>();
    for (const root of roots) {
      observer.observe(root); mutations.observe(root, { attributes: true, childList: true, subtree: true });
      let parent: Element | null = root.parentElement ?? (root.getRootNode() instanceof ShadowRoot ? (root.getRootNode() as ShadowRoot).host : null);
      while (parent) { ancestry.add(parent); const tree: Node = parent.getRootNode(); parent = parent.parentElement ?? (tree instanceof ShadowRoot ? tree.host : null); }
    }
    for (const tree of scrollRoots) if (tree instanceof ShadowRoot) mutations.observe(tree, { attributes: true, childList: true, subtree: true });
    for (const parent of ancestry) { observer.observe(parent); mutations.observe(parent, { attributes: true }); }
  };
  const draw = () => {
    frame = 0; if (disposed) return;
    syncRoots();
    renderer.render(createElement(InspectorOverlay, { target: null, rects: [...roots].flatMap(getCurrentRootRects) }));
  };
  const schedule = () => { if (!disposed && !frame) frame = view.requestAnimationFrame(draw); };
  const unsubscribe = subscribeOwners(schedule);
  view.addEventListener('scroll', schedule, true); view.addEventListener('resize', schedule);
  function resolveOwners() { return ownerIds.flatMap((id) => { const owner = getOwner(id); return owner ? [owner] : []; }); }
  draw();
  return () => {
    if (disposed) return; disposed = true;
    if (frame) view.cancelAnimationFrame(frame);
    observer.disconnect(); mutations.disconnect(); unsubscribe();
    for (const root of scrollRoots) root.removeEventListener('scroll', schedule, true);
    scrollRoots.clear(); roots.clear(); view.removeEventListener('scroll', schedule, true); view.removeEventListener('resize', schedule); renderer.unmount();
  };
}

export function highlightTarget(selector: UiSelector): () => void {
  const resolution = resolveSelector(selector);
  if (resolution.status !== 'resolved') return () => {};
  const dispose = showTargetRanges(resolution.owners.map((owner) => owner.ownerId));
  const timer = setTimeout(dispose, 3000);
  return () => { clearTimeout(timer); dispose(); };
}
