import { useState } from 'react';
import type { RemovalSnapshot, LauncherActions } from '../public/types';
import type { LauncherServices } from '../services';
import { domainBlocked, findProfile, useControllerOwner } from './owner';
type State = Omit<RemovalSnapshot, 'canSubmit'>;
const initial = (): State => ({
  profileKey: null,
  deleteFiles: false,
  confirmation: '',
  pending: false,
});
const reconnect = (state: State): State => ({ ...state, pending: false });
export function useRemovalController(services: LauncherServices): {
  snapshot: RemovalSnapshot;
  actions: LauncherActions['removal'];
} {
  const owner = useControllerOwner<State>(services, initial(), reconnect);
  const canSubmit = () => {
    const { profileKey, pending, deleteFiles, confirmation } = owner.state;
    const profile = profileKey ? findProfile(owner.services, profileKey) : null;
    return (
      owner.mounted &&
      !!profile &&
      !pending &&
      !domainBlocked(owner.services) &&
      (!deleteFiles || (owner.services.api.desktop && confirmation === profile.name))
    );
  };
  const [actions] = useState<LauncherActions['removal']>(() =>
    Object.freeze({
      open: (key) => {
        if (
          !owner.mounted ||
          !findProfile(owner.services, key) ||
          domainBlocked(owner.services) ||
          owner.services.getInteractionState().modalOpen
        )
          return;
        owner.generation++;
        owner.commit({ ...initial(), profileKey: key });
      },
      setDeleteFiles: (deleteFiles) => {
        if (
          !owner.mounted ||
          !owner.state.profileKey ||
          owner.state.pending ||
          (deleteFiles && !owner.services.api.desktop)
        )
          return;
        owner.commit({ ...owner.state, deleteFiles, confirmation: '' });
      },
      setConfirmation: (confirmation) => {
        if (owner.mounted && owner.state.profileKey && !owner.state.pending)
          owner.commit({ ...owner.state, confirmation });
      },
      cancel: () => {
        owner.generation++;
        owner.commit(initial());
      },
      submit: async () => {
        if (!canSubmit()) return false;
        const generation = owner.generation,
          { profileKey, deleteFiles } = owner.state;
        owner.commit({ ...owner.state, pending: true });
        try {
          const ok = await owner.services.launcher.removeProfile(profileKey!, deleteFiles);
          if (!owner.mounted || generation !== owner.generation) return false;
          if (ok) actions.cancel();
          return ok;
        } finally {
          if (owner.mounted && generation === owner.generation)
            owner.commit({ ...owner.state, pending: false });
        }
      },
    }),
  );
  return {
    get snapshot() {
      return {
        ...owner.state,
        get canSubmit() {
          return canSubmit();
        },
      };
    },
    actions,
  };
}
