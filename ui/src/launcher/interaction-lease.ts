import type { LauncherInteractionPublisher } from './services';
export interface InteractionFlags {
  editorOpen: boolean;
  picking: boolean;
  modalOpen: boolean;
}
interface Cell<T> {
  current: T;
}
/** A retained publisher can only update flags while its lease remains current. */
export function acquireInteractionLease(
  interaction: Cell<InteractionFlags>,
  interactionLease: Cell<object | null>,
  onChange: () => void,
): LauncherInteractionPublisher {
  const token = {};
  interactionLease.current = token;
  let released = false;
  const publish = (patch: Partial<typeof interaction.current>) => {
    if (released || !Object.is(interactionLease.current, token)) return;
    let changed = false;
    for (const key of ['editorOpen', 'picking', 'modalOpen'] as const) {
      if (typeof patch[key] === 'boolean' && interaction.current[key] !== patch[key]) {
        interaction.current[key] = patch[key];
        changed = true;
      }
    }
    if (changed) onChange();
  };
  return {
    publish,
    release() {
      if (released) return;
      if (Object.is(interactionLease.current, token)) {
        publish({ editorOpen: false, picking: false, modalOpen: false });
        interactionLease.current = null;
      }
      released = true;
    },
  };
}
