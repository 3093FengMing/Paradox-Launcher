export type UiNoticeKind = 'info' | 'success' | 'warning' | 'error';
export interface UiNotice {
  id: string;
  kind: UiNoticeKind;
  message: string;
  remainingMs: number;
}
export interface NoticeClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}
export interface UiNoticeStore {
  getSnapshot(): readonly UiNotice[];
  subscribe(listener: () => void): () => void;
  publish(kind: UiNoticeKind, message: string): string;
  dismiss(id: string): void;
  pause(id: string, source: 'pointer' | 'focus'): void;
  resume(id: string, source: 'pointer' | 'focus'): void;
  dispose(): void;
}
type Source = 'pointer' | 'focus';
interface Entry {
  notice: UiNotice;
  deadline: number;
  sources: Set<Source>;
  views: Map<object, Set<Source>>;
}
interface Internal {
  clock: NoticeClock;
  pause(owner: object, id: string, source: Source): void;
  resume(owner: object, id: string, source: Source): void;
  release(owner: object): void;
  owners: number;
}
const internals = new WeakMap<UiNoticeStore, Internal>();
const defaultClock: NoticeClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function createNoticeStore(clock: NoticeClock = defaultClock): UiNoticeStore {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let snapshot: readonly UiNotice[] = Object.freeze([]);
  let sequence = 0;
  let timer: unknown;
  let generation = 0;
  let disposed = false;
  const paused = (entry: Entry) => entry.sources.size > 0 || entry.views.size > 0;
  const emit = () => {
    snapshot = Object.freeze(
      [...entries.values()].map((entry) => Object.freeze({ ...entry.notice })),
    );
    for (const listener of listeners) listener();
  };
  const schedule = () => {
    const current = ++generation;
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
    const deadlines = [...entries.values()]
      .filter((entry) => !paused(entry))
      .map((entry) => entry.deadline);
    if (!deadlines.length || disposed) return;
    timer = clock.setTimeout(
      () => {
        // A cleared callback can already be queued; it never owns a later schedule.
        if (current !== generation || disposed) return;
        timer = undefined;
        for (const [id, entry] of entries)
          if (!paused(entry) && entry.deadline <= clock.now()) entries.delete(id);
        emit();
        schedule();
      },
      Math.max(0, Math.min(...deadlines) - clock.now()),
    );
  };
  const changePause = (id: string, change: (entry: Entry) => void) => {
    const entry = entries.get(id);
    if (!entry) return;
    const before = paused(entry);
    change(entry);
    const after = paused(entry);
    if (before === after) return;
    if (after) entry.notice.remainingMs = Math.max(0, entry.deadline - clock.now());
    else entry.deadline = clock.now() + entry.notice.remainingMs;
    emit();
    schedule();
  };
  const store: UiNoticeStore = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (!disposed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(kind, message) {
      const id = `notice-${++sequence}`;
      if (disposed) return id;
      const remainingMs = kind === 'error' ? 5000 : 3000;
      entries.set(id, {
        notice: { id, kind, message, remainingMs },
        deadline: clock.now() + remainingMs,
        sources: new Set(),
        views: new Map(),
      });
      emit();
      schedule();
      return id;
    },
    dismiss(id) {
      if (!entries.delete(id)) return;
      emit();
      schedule();
    },
    pause: (id, source) =>
      changePause(id, (entry) => {
        entry.sources.add(source);
      }),
    resume: (id, source) =>
      changePause(id, (entry) => {
        entry.sources.delete(source);
      }),
    dispose() {
      if (disposed) return;
      disposed = true;
      ++generation;
      if (timer !== undefined) clock.clearTimeout(timer);
      timer = undefined;
      entries.clear();
      emit();
      listeners.clear();
    },
  };
  internals.set(store, {
    clock,
    owners: 0,
    pause: (owner, id, source) =>
      changePause(id, (entry) => {
        const sources = entry.views.get(owner) ?? new Set<Source>();
        sources.add(source);
        entry.views.set(owner, sources);
      }),
    resume: (owner, id, source) =>
      changePause(id, (entry) => {
        const sources = entry.views.get(owner);
        sources?.delete(source);
        if (!sources?.size) entry.views.delete(owner);
      }),
    release: (owner) => {
      for (const id of entries.keys())
        changePause(id, (entry) => {
          entry.views.delete(owner);
        });
    },
  });
  return store;
}

// Internal view leases keep the public pointer/focus source set independent.
export function pauseNoticeForView(
  store: UiNoticeStore,
  owner: object,
  id: string,
  source: Source,
) {
  internals.get(store)?.pause(owner, id, source);
}
export function resumeNoticeForView(
  store: UiNoticeStore,
  owner: object,
  id: string,
  source: Source,
) {
  internals.get(store)?.resume(owner, id, source);
}
export function releaseNoticeView(store: UiNoticeStore, owner: object) {
  internals.get(store)?.release(owner);
}
export function noticeTime(store: UiNoticeStore) {
  return internals.get(store)?.clock.now() ?? Date.now();
}
// Effect cleanup is tentative until React has had the chance to reconnect refs.
export function retainNoticeStore(store: UiNoticeStore): () => void {
  const internal = internals.get(store)!;
  ++internal.owners;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    --internal.owners;
    queueMicrotask(() => {
      if (internal.owners === 0) store.dispose();
    });
  };
}
