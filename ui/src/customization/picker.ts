import type { UiSelector } from '../ui-suite/model';
import type { UiTargetDescriptor } from '../ui-editor/public';
import { getDomOwnership, getOwner, resolveSelector } from './ownership';
import { describeTarget } from './target-catalog';
import type { TargetCatalogContext } from './target-catalog';
import { getCurrentRootRects, isInspectorArtifact, showTargetRanges } from './highlight';
import { sameSelector } from './selectors';

interface PickerOptions {
  onHover(target: UiTargetDescriptor | null): void;
  onSelect(selector: UiSelector): void;
  onCancel(): void;
  /** Read the existing controller anchor/scope; no second selection state. */
  getSelector?(): UiSelector | null;
  subscribeSelection?(listener: () => void): () => void;
  getContext?(): TargetCatalogContext;
  onEnd?(): void;
}

/** Capture is independent of the normal editor mount, including replacement/crash. */
export function startPicker(options: PickerOptions): () => void {
  const view = window;
  let hover: UiTargetDescriptor | null = null, rangeCleanup: (() => void) | null = null;
  let rangeKey: string | null = null;
  let rangeUpdating = false, rangeDirty = false;
  let pending: UiSelector | null = null, pointerId: number | null = null;
  let cancelled = false, disposed = false, completing = false, timer = 0;
  let rangeFrame = 0;
  const artifact = (event: Event) => event.composedPath().some(node => node instanceof Element && (isInspectorArtifact(node) || node.hasAttribute('data-ui-inspector-controls')));
  const consume = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const selector = () => options.getSelector?.() ?? hover?.selector ?? null;
  const refreshRanges = () => {
    // Registry reads may synchronously publish controller changes. Own the returned
    // lease before processing that notification, so a nested refresh cannot orphan it.
    if (rangeUpdating) { rangeDirty = true; return; }
    rangeUpdating = true;
    try {
      const selected = !disposed && !cancelled && !completing && hover && selector();
      const resolution = selected && resolveSelector(selected);
      const ids = resolution && resolution.status === 'resolved' ? resolution.owners.map(owner => owner.ownerId) : [];
      const key = ids.length ? JSON.stringify(ids) : null;
      if (key !== rangeKey) {
        rangeCleanup?.(); rangeCleanup = null; rangeKey = key;
        if (ids.length) rangeCleanup = showTargetRanges(ids);
      }
    } finally { rangeUpdating = false; }
    if (rangeDirty) { rangeDirty = false; refreshRanges(); }
  };
  const pick = (event: Event): UiTargetDescriptor | null => {
    for (const node of event.composedPath()) {
      if (!(node instanceof Element)) continue;
      const ownership = getDomOwnership(node);
      // The registry's logical path is authoritative, deepest eligible owner first.
      const ids = ownership ? [...new Set([ownership.leafOwnerId, ...[...ownership.ownerIds].reverse()].filter((id): id is string => !!id))] : [];
      for (const id of ids) {
        const owner = getOwner(id); if (!owner) continue;
        const exact: UiSelector = { kind: 'position', target: owner.target, locator: owner.locator };
        if (![...owner.roots].some(root => getCurrentRootRects(root).some(rect => rect.right > 0 && rect.bottom > 0 && rect.left < view.innerWidth && rect.top < view.innerHeight))) continue;
        return describeTarget(exact, options.getContext?.());
      }
    }
    return null;
  };
  const scheduleRanges = () => {
    if (disposed || cancelled || rangeFrame) return;
    rangeFrame = view.requestAnimationFrame(() => { rangeFrame = 0; refreshRanges(); });
  };
  const move = (event: PointerEvent) => {
    if (cancelled || pointerId !== null || artifact(event)) return;
    const next = pick(event);
    if (next && hover ? sameSelector(next.selector, hover.selector) : next === hover) return;
    hover = next; options.onHover(next); scheduleRanges();
  };
  const finish = () => {
    if (disposed) return; disposed = true;
    view.clearTimeout(timer); rangeCleanup?.(); rangeCleanup = null; unsubscribe();
    if (rangeFrame) view.cancelAnimationFrame(rangeFrame); rangeFrame = 0;
    view.removeEventListener('pointermove', move, true);
    for (const name of ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']) view.removeEventListener(name, capture, true);
    view.removeEventListener('keydown', keydown, true);
    options.onEnd?.();
  };
  const cancel = () => {
    if (cancelled || disposed) return;
    cancelled = true; pending = null; rangeCleanup?.(); rangeCleanup = null;
    if (rangeFrame) view.cancelAnimationFrame(rangeFrame); rangeFrame = 0;
    options.onCancel();
    // A held gesture owns capture until its actual release, regardless of elapsed time.
    if (pointerId === null) finish();
  };
  const capture = (event: Event) => {
    if (disposed) return;
    if (pointerId === null && artifact(event)) return;
    if (event.type === 'pointerdown') {
      consume(event);
      if (cancelled || completing || pointerId !== null) return;
      const next = pick(event); if (next && hover ? !sameSelector(next.selector, hover.selector) : next !== hover) { hover = next; options.onHover(next); scheduleRanges(); }
      const chosen = selector(), resolution = chosen && resolveSelector(chosen);
      pending = hover && resolution?.status === 'resolved' ? structuredClone(chosen!) : null;
      pointerId = (event as PointerEvent).pointerId;
      return;
    }
    consume(event);
    if (event.type === 'pointercancel' && (event as PointerEvent).pointerId === pointerId) {
      pending = null; cancel(); completing = true;
      view.clearTimeout(timer); timer = view.setTimeout(finish, 0); return;
    }
    if (event.type === 'pointerup' && (event as PointerEvent).pointerId === pointerId) {
      // A released pointer may produce no click. Only an observed release starts
      // this fallback; another pointer's release cannot retire the held gesture.
      view.clearTimeout(timer); timer = view.setTimeout(() => { cancel(); finish(); }, 1200);
    }
    if (event.type === 'click' && pointerId !== null) {
      const chosen = pending; pending = null; completing = true;
      if (!cancelled && chosen) options.onSelect(chosen); else if (!cancelled) options.onCancel();
      // Keep capture for the entire dispatch and any same-task compatibility events.
      view.clearTimeout(timer); timer = view.setTimeout(finish, 0);
    }
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' || (event.ctrlKey && event.shiftKey && event.key === 'F12')) { consume(event); cancel(); }
  };
  const unsubscribe = options.subscribeSelection?.(scheduleRanges) ?? (() => {});
  view.addEventListener('pointermove', move, true);
  for (const name of ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']) view.addEventListener(name, capture, true);
  view.addEventListener('keydown', keydown, true);
  return cancel;
}
