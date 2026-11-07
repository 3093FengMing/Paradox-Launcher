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
  recovery: null,
  residuals: [],
});
const reconnect = (state: State): State => ({ ...state, pending: false });
export function useRemovalController(services: LauncherServices): {
  snapshot: RemovalSnapshot;
  actions: LauncherActions['removal'];
} {
  const owner = useControllerOwner<State>(services, initial(), reconnect);
  const canSubmit = () => {
    const { profileKey, pending, deleteFiles, confirmation, recovery } = owner.state;
    const profile = profileKey ? findProfile(owner.services, profileKey) : null;
    return (
      owner.mounted &&
      (!!profile || !!recovery) &&
      !pending &&
      !domainBlocked(owner.services) &&
      (recovery
        ? owner.services.api.desktop
        : !deleteFiles || (owner.services.api.desktop && confirmation === profile?.name))
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
        owner.commit({ ...initial(), residuals: owner.state.residuals, profileKey: key });
      },
      openResidual: (token) => {
        const recovery = owner.state.residuals.find((issue) => issue.token === token);
        if (
          !owner.mounted ||
          !recovery ||
          domainBlocked(owner.services) ||
          owner.services.getInteractionState().modalOpen
        )
          return;
        owner.generation++;
        owner.commit({
          ...initial(),
          residuals: owner.state.residuals,
          profileKey: recovery.profileKey,
          recovery,
          deleteFiles: true,
        });
      },
      setDeleteFiles: (deleteFiles) => {
        if (
          !owner.mounted ||
          !owner.state.profileKey ||
          owner.state.pending ||
          owner.state.recovery ||
          (deleteFiles && !owner.services.api.desktop)
        )
          return;
        owner.commit({ ...owner.state, deleteFiles, confirmation: '' });
      },
      setConfirmation: (confirmation) => {
        if (
          owner.mounted &&
          owner.state.profileKey &&
          !owner.state.pending &&
          !owner.state.recovery
        )
          owner.commit({ ...owner.state, confirmation });
      },
      cancel: () => {
        if (!owner.mounted || owner.state.pending) return;
        owner.generation++;
        owner.commit({ ...initial(), residuals: owner.state.residuals });
      },
      submit: async () => {
        if (!canSubmit()) return false;
        const generation = owner.generation,
          { profileKey, deleteFiles, recovery } = owner.state;
        const name =
          recovery?.name ?? findProfile(owner.services, profileKey!)?.name ?? profileKey!;
        owner.commit({ ...owner.state, pending: true });
        try {
          const result = recovery
            ? await owner.services.launcher.retryProfileFiles(recovery.token)
            : await owner.services.launcher.removeProfile(profileKey!, deleteFiles);
          if (!owner.mounted || generation !== owner.generation) return false;
          if (!result) return false;
          const residuals = owner.state.residuals.filter(
            (issue) => issue.token !== recovery?.token,
          );
          if (result.file_removal_error && result.file_removal_retry && result.instance_root) {
            const issue = {
              profileKey: profileKey!,
              name,
              token: result.file_removal_retry,
              instanceRoot: result.instance_root,
              error: result.file_removal_error,
            };
            owner.commit({ ...owner.state, recovery: issue, residuals: [...residuals, issue] });
            return false;
          }
          owner.commit({ ...initial(), residuals });
          return true;
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
