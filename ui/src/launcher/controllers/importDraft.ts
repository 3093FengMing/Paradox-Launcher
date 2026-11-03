import { useState } from 'react';
import i18n from '../../i18n';
import type { ImportDraftSnapshot, LauncherActions } from '../public/types';
import type { LauncherServices } from '../services';
import { domainBlocked, useControllerOwner } from './owner';
type State = Omit<ImportDraftSnapshot, 'canSubmit'>;
const initial = (): State => ({
  open: false,
  directory: '',
  scannedDirectory: '',
  instances: null,
  selected: [],
  scanning: false,
  picking: false,
  pending: false,
});
const reconnect = (state: State): State => ({
  ...state,
  scanning: false,
  picking: false,
  pending: false,
});
export function useImportDraftController(services: LauncherServices): {
  snapshot: ImportDraftSnapshot;
  actions: LauncherActions['importDraft'];
} {
  const owner = useControllerOwner<State>(services, initial(), reconnect);
  const [scanOwner] = useState(() => ({ sequence: 0 }));
  const available = () =>
    owner.mounted &&
    owner.state.open &&
    owner.services.api.desktop &&
    !owner.state.pending &&
    !domainBlocked(owner.services);
  const eligible = () =>
    (owner.state.instances ?? [])
      .filter((instance) => instance.loader === 'vanilla' && !!instance.game_version)
      .map((instance) => instance.instance_key);
  const canSubmit = () => {
    const state = owner.state;
    return (
      available() &&
      !state.scanning &&
      !state.picking &&
      !!state.directory.trim() &&
      state.directory === state.scannedDirectory &&
      state.instances !== null &&
      state.selected.length > 0 &&
      state.selected.every((key) => eligible().includes(key))
    );
  };
  const scan = async () => {
    if (
      !available() ||
      owner.state.scanning ||
      owner.state.picking ||
      !owner.state.directory.trim()
    )
      return;
    const generation = owner.generation,
      sequence = ++scanOwner.sequence,
      directory = owner.state.directory;
    owner.commit({
      ...owner.state,
      scanning: true,
      scannedDirectory: '',
      instances: null,
      selected: [],
    });
    try {
      const instances = await owner.services.api.scanImport(directory);
      if (
        !owner.mounted ||
        generation !== owner.generation ||
        sequence !== scanOwner.sequence ||
        directory !== owner.state.directory
      )
        return;
      owner.commit({
        ...owner.state,
        instances,
        scannedDirectory: directory,
        selected: instances
          .filter((instance) => instance.loader === 'vanilla' && !!instance.game_version)
          .map((instance) => instance.instance_key),
      });
    } catch (error) {
      if (owner.mounted && generation === owner.generation && sequence === scanOwner.sequence)
        owner.services.launcher.reportError(error);
    } finally {
      if (owner.mounted && generation === owner.generation && sequence === scanOwner.sequence)
        owner.commit({ ...owner.state, scanning: false });
    }
  };
  const [actions] = useState<LauncherActions['importDraft']>(() =>
    Object.freeze({
      open: () => {
        if (
          !owner.mounted ||
          domainBlocked(owner.services) ||
          owner.services.getInteractionState().modalOpen
        )
          return;
        owner.generation++;
        scanOwner.sequence++;
        owner.commit({ ...initial(), open: true });
      },
      setDirectory: (directory) => {
        if (!owner.mounted || !owner.state.open || owner.state.pending) return;
        owner.generation++;
        scanOwner.sequence++;
        owner.commit({
          ...owner.state,
          directory,
          scannedDirectory: '',
          instances: null,
          selected: [],
          scanning: false,
          picking: false,
        });
      },
      setSelected: (keys) => {
        if (
          !available() ||
          owner.state.scanning ||
          owner.state.picking ||
          owner.state.directory !== owner.state.scannedDirectory
        )
          return;
        owner.commit({
          ...owner.state,
          selected: [...new Set(keys.filter((key) => eligible().includes(key)))],
        });
      },
      cancel: () => {
        owner.generation++;
        scanOwner.sequence++;
        owner.commit(initial());
      },
      chooseDirectory: async () => {
        if (
          !available() ||
          owner.state.scanning ||
          owner.state.picking ||
          owner.services.getInteractionState().picking
        )
          return;
        const generation = owner.generation;
        owner.commit({ ...owner.state, picking: true });
        try {
          const path = await owner.services.api.chooseDirectory(i18n.t('importDialog.chooseRoot'));
          if (!owner.mounted || generation !== owner.generation) return;
          owner.commit({ ...owner.state, picking: false });
          if (path && available()) {
            actions.setDirectory(path);
            await scan();
          }
        } catch (error) {
          if (owner.mounted && generation === owner.generation)
            owner.services.launcher.reportError(error);
        } finally {
          if (owner.mounted && generation === owner.generation)
            owner.commit({ ...owner.state, picking: false });
        }
      },
      scan,
      submit: async () => {
        if (!canSubmit()) return false;
        const generation = owner.generation,
          { scannedDirectory, selected } = owner.state;
        owner.commit({ ...owner.state, pending: true });
        try {
          const ok = await owner.services.launcher.importProfiles(scannedDirectory, [...selected]);
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
