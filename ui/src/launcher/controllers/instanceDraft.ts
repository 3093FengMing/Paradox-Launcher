import { useState } from 'react';
import i18n from '../../i18n';
import { environmentRows, environmentFromRows } from '../../lib/argument-templates';
import { validateProfileSettings } from '../../lib/forms';
import type { EnvironmentRow } from '../../lib/argument-templates';
import type { GameProfile, ProfileOverrides } from '../../types';
import type { InstanceDraftSnapshot, LauncherActions } from '../public/types';
import type { LauncherServices } from '../services';
import { domainBlocked, findProfile, useControllerOwner } from './owner';
type State = {
  profile: GameProfile | null;
  environment: EnvironmentRow[];
  pending: boolean;
  picking: boolean;
};
const reconnect = (state: State): State => ({ ...state, pending: false, picking: false });
export function useInstanceDraftController(services: LauncherServices): {
  snapshot: InstanceDraftSnapshot;
  actions: LauncherActions['instanceDraft'];
} {
  const owner = useControllerOwner<State>(
    services,
    { profile: null, environment: [], pending: false, picking: false },
    reconnect,
  );
  const candidate = () => {
    const state = owner.state,
      config = owner.services.launcher.getGuardState().config;
    if (!state.profile || !config || !findProfile(owner.services, state.profile.instance_key))
      return null;
    const profile = {
      ...state.profile,
      name: state.profile.name.trim(),
      overrides: {
        ...state.profile.overrides,
        environment: environmentFromRows(state.environment),
      },
    };
    validateProfileSettings(profile, config.settings);
    return profile;
  };
  const canSubmit = () => {
    if (
      !owner.mounted ||
      owner.state.pending ||
      owner.state.picking ||
      domainBlocked(owner.services)
    )
      return false;
    try {
      return candidate() !== null;
    } catch {
      return false;
    }
  };
  const patchOverride = <K extends keyof ProfileOverrides>(key: K, value: ProfileOverrides[K]) => {
    const state = owner.state;
    if (!owner.mounted || !state.profile || state.pending || state.picking) return;
    if (
      ![
        'argument_template',
        'environment',
        'java_executable',
        'memory_mb',
        'minimum_memory_mb',
        'resolution_width',
        'resolution_height',
        'extra_jvm_arguments',
        'extra_game_arguments',
      ].includes(key)
    )
      return;
    owner.commit({
      ...state,
      environment:
        key === 'environment'
          ? environmentRows(value as ProfileOverrides['environment'])
          : state.environment,
      profile: {
        ...state.profile,
        overrides: { ...state.profile.overrides, [key]: structuredClone(value) },
      },
    });
  };
  const [actions] = useState<LauncherActions['instanceDraft']>(() => {
    const choose = async (kind: 'java' | 'directory') => {
      const state = owner.state,
        s = owner.services;
      if (
        !owner.mounted ||
        !state.profile ||
        state.pending ||
        state.picking ||
        !s.api.desktop ||
        domainBlocked(s) ||
        s.getInteractionState().picking
      )
        return;
      const generation = owner.generation;
      owner.commit({ ...state, picking: true });
      try {
        const path =
          kind === 'java'
            ? await s.api.chooseJava()
            : await s.api.chooseDirectory(i18n.t('instanceDialog.gameRoot'));
        if (!path || !owner.mounted || generation !== owner.generation) return;
        const installation = kind === 'java' ? await s.api.inspectJava(path) : null;
        if (
          !owner.mounted ||
          generation !== owner.generation ||
          domainBlocked(owner.services) ||
          !owner.state.profile
        )
          return;
        const profile = owner.state.profile;
        owner.commit({
          ...owner.state,
          profile: installation
            ? {
                ...profile,
                overrides: { ...profile.overrides, java_executable: installation.executable },
              }
            : { ...profile, game_directory: path },
        });
      } catch (error) {
        if (owner.mounted && generation === owner.generation)
          owner.services.launcher.reportError(error);
      } finally {
        if (owner.mounted && generation === owner.generation)
          owner.commit({ ...owner.state, picking: false });
      }
    };
    return Object.freeze({
      open: (key: string) => {
        const profile = findProfile(owner.services, key);
        if (
          !owner.mounted ||
          !profile ||
          domainBlocked(owner.services) ||
          owner.services.getInteractionState().modalOpen
        )
          return;
        owner.generation++;
        owner.commit({
          profile: structuredClone(profile),
          environment: environmentRows(profile.overrides.environment),
          pending: false,
          picking: false,
        });
      },
      patch: (patch) => {
        const state = owner.state;
        if (!owner.mounted || !state.profile || state.pending || state.picking) return;
        owner.commit({
          ...state,
          profile: {
            ...state.profile,
            ...(Object.hasOwn(patch, 'name') ? { name: patch.name! } : {}),
            ...(Object.hasOwn(patch, 'game_directory')
              ? { game_directory: patch.game_directory! }
              : {}),
          },
        });
      },
      patchOverride,
      setEnvironment: (rows) => {
        if (!owner.mounted || !owner.state.profile || owner.state.pending || owner.state.picking)
          return;
        owner.commit({ ...owner.state, environment: structuredClone(rows) });
      },
      cancel: () => {
        owner.generation++;
        owner.commit({ profile: null, environment: [], pending: false, picking: false });
      },
      chooseJava: () => choose('java'),
      chooseDirectory: () => choose('directory'),
      submit: async () => {
        if (
          !owner.mounted ||
          owner.state.pending ||
          owner.state.picking ||
          domainBlocked(owner.services)
        )
          return false;
        let profile: GameProfile | null;
        try {
          profile = candidate();
        } catch (error) {
          owner.services.launcher.reportError(error);
          return false;
        }
        if (!profile) return false;
        const generation = owner.generation;
        owner.commit({ ...owner.state, pending: true });
        try {
          const ok = await owner.services.launcher.updateProfile(profile);
          if (!owner.mounted || generation !== owner.generation) return false;
          if (ok) actions.cancel();
          return ok;
        } finally {
          if (owner.mounted && generation === owner.generation)
            owner.commit({ ...owner.state, pending: false });
        }
      },
    } satisfies LauncherActions['instanceDraft']);
  });
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
