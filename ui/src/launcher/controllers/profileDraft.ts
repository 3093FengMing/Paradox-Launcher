import { useEffect, useState } from 'react';
import { errorMessage } from '../../lib/errors';
import { validateProfileName } from '../../lib/forms';
import type { ProfileEditor } from '../../lib/forms';
import type { GameProfile } from '../../types';
import type { LauncherServices } from '../services';
import type { LoaderCatalogSnapshot, ProfileDraftSnapshot, LauncherActions } from '../public/types';
import { domainBlocked, findProfile, useControllerOwner } from './owner';

type State = { editor: ProfileEditor | null; pending: boolean; catalog: LoaderCatalogSnapshot };
const emptyCatalog = (): LoaderCatalogSnapshot => ({
  request: null,
  versions: [],
  pending: false,
  error: null,
});
const reconnect = (state: State): State => ({ ...state, pending: false, catalog: emptyCatalog() });
const loaders = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'];
export function useProfileDraftController(services: LauncherServices): {
  snapshot: ProfileDraftSnapshot;
  actions: LauncherActions['profileDraft'];
  requestLoaders: LauncherActions['catalog']['requestLoaders'];
} {
  const owner = useControllerOwner<State>(
    services,
    { editor: null, pending: false, catalog: emptyCatalog() },
    reconnect,
  );
  const [query] = useState(() => ({
    sequence: 0,
    active: null as Promise<void> | null,
    timer: null as number | null,
  }));
  const invalidate = () => {
    query.sequence++;
    query.active = null;
    if (query.timer !== null) {
      window.clearTimeout(query.timer);
      query.timer = null;
    }
  };
  const canSubmit = () => {
    const { editor, pending, catalog } = owner.state;
    if (!owner.mounted || !editor || pending || domainBlocked(owner.services)) return false;
    try {
      validateProfileName(editor.name);
    } catch {
      return false;
    }
    if (!editor.version.trim() || !loaders.includes(editor.loader ?? 'vanilla')) return false;
    if (editor.editKey) return !!findProfile(owner.services, editor.editKey);
    if ((editor.loader ?? 'vanilla') === 'vanilla') return true;
    return (
      catalog.request !== null &&
      catalog.request.loader === editor.loader &&
      catalog.request.game === editor.version &&
      !catalog.pending &&
      !catalog.error &&
      catalog.versions.some((item) => item.version === editor.loader_version)
    );
  };
  const [requestLoaders] = useState<LauncherActions['catalog']['requestLoaders']>(
    () => (loader: Exclude<GameProfile['loader'], 'vanilla'>, game: string) => {
      if (
        !owner.mounted ||
        !loaders.includes(loader) ||
        loader === ('vanilla' as GameProfile['loader']) ||
        !game.trim()
      )
        return Promise.resolve();
      const current = owner.state.catalog;
      if (
        current.request !== null &&
        current.request.loader === loader &&
        current.request.game === game &&
        !current.error
      ) {
        if (query.active) return query.active;
        if (!current.pending) return Promise.resolve();
      }
      invalidate();
      const sequence = query.sequence,
        generation = owner.generation;
      owner.commit({
        ...owner.state,
        catalog: { request: { loader, game }, versions: [], pending: true, error: null },
      });
      const task = (async () => {
        try {
          const values = await owner.services.api.loaderVersions(loader, game);
          if (!owner.mounted || generation !== owner.generation || sequence !== query.sequence)
            return;
          owner.commit({
            ...owner.state,
            catalog: {
              request: { loader, game },
              versions: values.map(({ version, stable }) => ({ version, stable })),
              pending: false,
              error: null,
            },
          });
        } catch (error) {
          if (owner.mounted && generation === owner.generation && sequence === query.sequence)
            owner.commit({
              ...owner.state,
              catalog: {
                request: { loader, game },
                versions: [],
                pending: false,
                error: errorMessage(error),
              },
            });
        } finally {
          if (sequence === query.sequence) query.active = null;
        }
      })();
      query.active = task;
      return task;
    },
  );
  const schedule = () => {
    const editor = owner.state.editor;
    if (
      !editor ||
      editor.editKey ||
      !editor.version ||
      !editor.loader ||
      editor.loader === 'vanilla'
    )
      return;
    const { loader, version } = editor;
    owner.commit({
      ...owner.state,
      catalog: { request: { loader, game: version }, versions: [], pending: true, error: null },
    });
    query.timer = window.setTimeout(() => {
      query.timer = null;
      void requestLoaders(loader, version);
    }, 300);
  };
  useEffect(() => {
    // Reconnect invalidates both held IPC and its automatic timer.
    invalidate();
    schedule();
    return invalidate;
    // owner/query are stable; event handlers keep the current draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, query]);
  const [actions] = useState<LauncherActions['profileDraft']>(() =>
    Object.freeze({
      openCreate: (version) => {
        if (
          !owner.mounted ||
          domainBlocked(owner.services) ||
          owner.services.getInteractionState().modalOpen
        )
          return;
        invalidate();
        owner.generation++;
        owner.commit({
          editor: {
            name: '',
            version:
              version ??
              owner.services.launcher.versions.find((item) => item.kind === 'release')?.id ??
              '1.21.1',
          },
          pending: false,
          catalog: emptyCatalog(),
        });
      },
      openRename: (key) => {
        const profile = findProfile(owner.services, key);
        if (
          !owner.mounted ||
          !profile ||
          domainBlocked(owner.services) ||
          owner.services.getInteractionState().modalOpen
        )
          return;
        invalidate();
        owner.generation++;
        owner.commit({
          editor: {
            name: profile.name,
            version: profile.game_version,
            loader: profile.loader,
            loader_version: profile.loader_version,
            editKey: key,
          },
          pending: false,
          catalog: emptyCatalog(),
        });
      },
      patch: (patch) => {
        const editor = owner.state.editor;
        if (!owner.mounted || !editor || owner.state.pending) return;
        const next = { ...editor, ...structuredClone(patch) };
        // Rename only changes the name; instance identity remains the saved one.
        if (editor.editKey) {
          owner.commit({ ...owner.state, editor: { ...editor, name: patch.name ?? editor.name } });
          return;
        }
        delete next.editKey;
        if (next.loader !== editor.loader || next.version !== editor.version) {
          invalidate();
          next.loader_version = '';
          owner.commit({ ...owner.state, editor: next, catalog: emptyCatalog() });
          schedule();
        } else owner.commit({ ...owner.state, editor: next });
      },
      cancel: () => {
        invalidate();
        owner.generation++;
        owner.commit({ editor: null, pending: false, catalog: emptyCatalog() });
      },
      submit: async () => {
        if (!canSubmit()) return false;
        const generation = owner.generation,
          editor = structuredClone(owner.state.editor!);
        owner.commit({ ...owner.state, pending: true });
        try {
          const ok = await owner.services.launcher.saveProfile({
            ...editor,
            name: editor.name.trim(),
          });
          if (!owner.mounted || generation !== owner.generation) return false;
          if (ok) {
            actions.cancel();
            owner.services.navigate('instances');
          }
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
        editor: owner.state.editor,
        pending: owner.state.pending,
        get canSubmit() {
          return canSubmit();
        },
        loaderCatalog: owner.state.catalog,
      };
    },
    actions,
    requestLoaders,
  };
}
