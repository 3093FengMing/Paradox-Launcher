import { useState } from 'react';
import i18n from '../../i18n';
import { canStopLaunch, isLaunchActive } from '../../lib/activity';
import { profileIsInstalled } from '../../lib/instances';
import type { LauncherServices } from '../services';
import type { LaunchSnapshot, LauncherActions } from '../public/types';
import { findProfile, useControllerOwner } from './owner';
import { getDomainBlockReason, getLaunchBlockReason } from '../capabilities';
import { installProfile } from './install';

type State = {
  selection: { profileKey: string; accountId: string | null; submitting: boolean } | null;
};
const reconnect = (state: State): State => ({
  selection: state.selection ? { ...state.selection, submitting: false } : null,
});
export function useLaunchController(services: LauncherServices): {
  snapshot: LaunchSnapshot;
  actions: LauncherActions['launch'];
} {
  const owner = useControllerOwner<State>(services, { selection: null }, reconnect);
  const allowed = (includeModal: boolean) => {
    return owner.mounted && getLaunchBlockReason(owner.services, includeModal) === null;
  };
  const installed = (key: string) => {
    const s = owner.services,
      current = s.launcher.getGuardState(),
      profile = findProfile(s, key);
    return profile &&
      current.config &&
      profileIsInstalled(profile, current.config.settings, current.installed)
      ? profile
      : null;
  };
  const canConfirm = () => {
    const draft = owner.state.selection;
    if (!draft || draft.submitting || !allowed(false) || !installed(draft.profileKey)) return false;
    return (
      draft.accountId === null ||
      owner.services.accounts
        .getLaunchState()
        .state.accounts.some((item) => item.id === draft.accountId)
    );
  };
  const [actions] = useState<LauncherActions['launch']>(() =>
    Object.freeze({
      request: async (key) => {
        const s = owner.services,
          profile = findProfile(s, key),
          interaction = s.getInteractionState();
        if (
          !owner.mounted ||
          !s.api.desktop ||
          !profile ||
          getDomainBlockReason(s, false) ||
          owner.state.selection ||
          interaction.editorOpen ||
          interaction.picking ||
          interaction.modalOpen
        )
          return;
        if (!installed(key)) {
          const generation = owner.generation;
          if ((await installProfile(s, key)) && owner.mounted && generation === owner.generation)
            s.launcher.notify(i18n.t('messages.profileQueued', { name: profile.name }));
          return;
        }
        if (!allowed(true)) return;
        const account = s.accounts.getLaunchState().state;
        if (account.accounts.length) {
          owner.generation++;
          owner.commit({
            selection: {
              profileKey: key,
              accountId:
                account.active && account.accounts.some((item) => item.id === account.active)
                  ? account.active
                  : null,
              submitting: false,
            },
          });
        } else await s.launcher.runAction('launch', profile);
      },
      chooseAccount: (id) => {
        const draft = owner.state.selection;
        if (
          !owner.mounted ||
          !draft ||
          draft.submitting ||
          (id !== null &&
            !owner.services.accounts.getLaunchState().state.accounts.some((item) => item.id === id))
        )
          return;
        owner.commit({ selection: { ...draft, accountId: id } });
      },
      confirmAccount: async () => {
        if (!canConfirm()) return;
        const draft = owner.state.selection!,
          generation = owner.generation;
        const accountGeneration = owner.services.accounts.getLaunchState().generation;
        owner.commit({ selection: { ...draft, submitting: true } });
        try {
          const ok = await owner.services.accounts.select(draft.accountId);
          if (
            !ok ||
            !owner.mounted ||
            owner.generation !== generation ||
            !allowed(false) ||
            owner.services.accounts.getLaunchState().generation !== accountGeneration
          )
            return;
          const profile = installed(draft.profileKey),
            account = owner.services.accounts.getLaunchState().state;
          if (
            !profile ||
            account.active !== draft.accountId ||
            (draft.accountId !== null &&
              !account.accounts.some((item) => item.id === draft.accountId))
          )
            return;
          owner.commit({ selection: null });
          await owner.services.launcher.runAction('launch', profile);
        } finally {
          if (owner.mounted && generation === owner.generation && owner.state.selection)
            owner.commit({ selection: { ...owner.state.selection, submitting: false } });
        }
      },
      cancelSelection: () => {
        owner.generation++;
        owner.commit({ selection: null });
      },
      stop: () => owner.services.launcher.stopGame(),
    }),
  );
  return {
    get snapshot() {
      const activity = owner.services.launcher.getGuardState().busy;
      return {
        phase: isLaunchActive(activity) ? (activity!.status as LaunchSnapshot['phase']) : 'idle',
        canStop: canStopLaunch(activity),
        selection: owner.state.selection
          ? {
              ...owner.state.selection,
              get canSubmit() {
                return canConfirm();
              },
            }
          : null,
      };
    },
    actions,
  };
}
