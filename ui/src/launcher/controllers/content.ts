import { useEffect, useState } from 'react';
import type {
  ContentCategory,
  ContentKind,
  ContentSnapshot,
  LauncherActions,
} from '../public/types';
import type { LauncherServices } from '../services';
import { domainBlocked, findProfile, useControllerOwner } from './owner';
import i18n from '../../i18n';
import { errorMessage } from '../../lib/errors';
const categories: readonly ContentCategory[] = ['mods', 'resourcepacks', 'shaderpacks', 'saves'];
const kinds: readonly ContentKind[] = ['mod', 'modpack', 'resourcepack', 'shader'];
const initial = (): ContentSnapshot => ({
  selectedProfileKey: null,
  category: 'mods',
  query: '',
  kind: 'mod',
  request: null,
  results: null,
  searchError: null,
  list: null,
  listRequest: null,
  pending: false,
  searching: false,
  removing: null,
  includeSaves: false,
});
const reconnect = (state: ContentSnapshot): ContentSnapshot => ({
  ...state,
  list: null,
  listRequest: null,
  pending: false,
  searching: false,
});
export function useContentController(services: LauncherServices): {
  snapshot: ContentSnapshot;
  actions: LauncherActions['content'];
  readonly picking: boolean;
} {
  const owner = useControllerOwner(services, initial(), reconnect);
  const [requests] = useState(() => ({
    initialized: false,
    explicitEmpty: false,
    activated: false,
    navigation: null as number | null,
    listKey: null as string | null,
    listToken: 0,
    searchToken: 0,
    operation: null as symbol | null,
    operationGeneration: -1,
    picking: false,
  }));
  const navigationTarget = () => {
    const navigation = owner.services.getNavigation();
    const detail = navigation.routeId === 'custom.instance-details';
    const scoped = navigation.routeId === 'content' || navigation.routeId.startsWith('custom.');
    const key = scoped ? navigation.params.profileKey : undefined;
    return {
      stamp: navigation.entryId,
      explicit: detail || key !== undefined,
      detail,
      key: key && findProfile(owner.services, key) ? key : null,
    };
  };
  const selectedKey = () => {
    const target = navigationTarget();
    // Details always belong to their current route. Other custom pages consume
    // an entry hint once, so their explicit discovery selector remains usable.
    return target.detail || (target.explicit && target.stamp !== requests.navigation)
      ? target.key
      : owner.state.selectedProfileKey;
  };
  const identity = () => {
    const config = owner.services.launcher.getGuardState().config;
    const profile = config?.profiles.find((value) => value.instance_key === selectedKey());
    return profile && config
      ? {
          profileKey: profile.instance_key,
          directory: profile.game_directory ?? config.settings.game_directory,
          category: owner.state.category,
        }
      : null;
  };
  const sameIdentity = (value: ReturnType<typeof identity>) => {
    const current = identity();
    return value === null
      ? current === null
      : current !== null &&
          value.profileKey === current.profileKey &&
          value.directory === current.directory &&
          value.category === current.category;
  };
  const active = () => requests.activated || owner.services.getNavigation().routeId === 'content';
  const invalidateList = () => {
    requests.listToken++;
    requests.listKey = null;
    owner.commit({ ...owner.state, list: null, listRequest: null, removing: null });
  };
  const requestList = async (force = false) => {
    const value = identity();
    if (!owner.mounted || !active() || !owner.services.api.desktop || !value) return;
    const terminal = owner.services.downloads
      .getGuardState()
      .tasks.filter((task) => ['completed', 'failed', 'cancelled'].includes(task.status))
      .map((task) => `${task.id}:${task.status}`)
      .join(',');
    const key = JSON.stringify([value, terminal, owner.generation]);
    if (!force && requests.listKey === key) return;
    requests.listKey = key;
    const token = ++requests.listToken,
      generation = owner.generation;
    owner.commit({
      ...owner.state,
      list: null,
      listRequest: { ...value, loading: true, error: null },
    });
    const current = () =>
      owner.mounted &&
      generation === owner.generation &&
      token === requests.listToken &&
      sameIdentity(value);
    try {
      const entries = await owner.services.api.listContent(value.profileKey, value.category);
      if (current())
        owner.commit({
          ...owner.state,
          list: { ...value, entries },
          listRequest: { ...value, loading: false, error: null },
        });
    } catch (error) {
      if (current()) {
        owner.commit({
          ...owner.state,
          listRequest: { ...value, loading: false, error: errorMessage(error) },
        });
        owner.services.launcher.reportError(error);
      }
    }
  };
  const canMutate = () =>
    owner.mounted &&
    owner.services.api.desktop &&
    !owner.state.pending &&
    !domainBlocked(owner.services);
  const hasEntry = (name: string) =>
    !!owner.state.list &&
    sameIdentity(
      owner.state.list && {
        profileKey: owner.state.list.profileKey,
        directory: owner.state.list.directory,
        category: owner.state.list.category,
      },
    ) &&
    owner.state.list.entries.some((entry) => entry.name === name);
  const perform = async (action: (current: () => boolean) => Promise<unknown>, refresh = true) => {
    if (requests.operation && requests.operationGeneration === owner.generation) return;
    const token = Symbol(),
      generation = owner.generation,
      value = identity();
    requests.operation = token;
    requests.operationGeneration = generation;
    owner.commit({ ...owner.state, pending: true });
    const current = () =>
      owner.mounted && generation === owner.generation && requests.operation === token;
    try {
      await action(current);
      if (current() && sameIdentity(value) && refresh) void requestList(true);
    } catch (error) {
      if (current()) owner.services.launcher.reportError(error);
    } finally {
      if (current()) {
        requests.operation = null;
        requests.picking = false;
        owner.commit({ ...owner.state, pending: false });
      }
    }
  };
  const [actions] = useState<LauncherActions['content']>(() =>
    Object.freeze({
      selectProfile: (key) => {
        if (!owner.mounted || (key !== null && !findProfile(owner.services, key))) return;
        const target = navigationTarget();
        if (target.detail && key !== target.key) return;
        requests.navigation = target.stamp;
        requests.initialized = true;
        requests.explicitEmpty = key === null;
        requests.activated = true;
        if (owner.state.selectedProfileKey !== key) {
          owner.commit({ ...owner.state, selectedProfileKey: key });
          invalidateList();
        }
        void requestList();
      },
      setCategory: (category) => {
        if (!owner.mounted || !categories.includes(category)) return;
        requests.activated = true;
        if (owner.state.category !== category) {
          owner.commit({ ...owner.state, category });
          invalidateList();
        }
        void requestList();
      },
      patchSearch: (patch) => {
        if (!owner.mounted || (patch.kind !== undefined && !kinds.includes(patch.kind))) return;
        owner.commit({
          ...owner.state,
          query: patch.query ?? owner.state.query,
          kind: patch.kind ?? owner.state.kind,
        });
      },
      search: async (pageOffset) => {
        const offset = pageOffset ?? 0;
        if (
          !owner.mounted ||
          !owner.services.api.desktop ||
          !Number.isInteger(offset) ||
          offset < 0 ||
          offset > 10000
        )
          return;
        const previous = owner.state.request;
        if (
          offset > 0 &&
          !(previous?.offset === offset && owner.state.searchError !== null) &&
          (!previous || !owner.state.results || offset >= owner.state.results.total_hits)
        )
          return;
        const request =
          pageOffset !== undefined && previous
            ? { ...previous, offset }
            : { query: owner.state.query, kind: owner.state.kind, offset };
        const token = ++requests.searchToken,
          generation = owner.generation;
        owner.commit({
          ...owner.state,
          request,
          results: null,
          searching: true,
          searchError: null,
        });
        const current = () =>
          owner.mounted && generation === owner.generation && token === requests.searchToken;
        try {
          const results = await owner.services.api.searchContent(
            request.query,
            request.kind,
            request.offset,
          );
          if (current()) owner.commit({ ...owner.state, results });
        } catch (error) {
          if (current()) {
            owner.commit({ ...owner.state, searchError: errorMessage(error) });
            owner.services.launcher.reportError(error);
          }
        } finally {
          if (current()) owner.commit({ ...owner.state, searching: false });
        }
      },
      refresh: async () => {
        if (owner.mounted && !owner.state.pending) {
          requests.activated = true;
          await requestList(true);
        }
      },
      toggleMod: async (name) => {
        const value = identity();
        if (!canMutate() || !value || value.category !== 'mods' || !hasEntry(name)) return;
        await perform(() => owner.services.api.toggleMod(value.profileKey, name));
      },
      beginRemove: (removing) => {
        if (canMutate() && owner.state.category !== 'saves' && hasEntry(removing))
          owner.commit({ ...owner.state, removing });
      },
      cancelRemove: () => {
        if (owner.mounted && !owner.state.pending) owner.commit({ ...owner.state, removing: null });
      },
      confirmRemove: async () => {
        const value = identity(),
          name = owner.state.removing;
        if (!canMutate() || !value || value.category === 'saves' || !name || !hasEntry(name))
          return;
        await perform(async (current) => {
          await owner.services.api.removeContent(value.profileKey, value.category, name);
          if (current() && sameIdentity(value) && owner.state.removing === name)
            owner.commit({ ...owner.state, removing: null });
        });
      },
      openDirectory: async () => {
        const value = identity();
        if (!owner.mounted || !owner.services.api.desktop || owner.state.pending || !value) return;
        await perform(() =>
          owner.services.api.openContentDirectory(value.profileKey, value.category),
        );
      },
      installProject: async (projectId, kind) => {
        if (typeof projectId !== 'string') return;
        projectId = projectId.trim();
        const value = identity(),
          profile = value ? findProfile(owner.services, value.profileKey) : null;
        // Match the existing backend identifier policy; never interpret it as a path.
        if (
          !canMutate() ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(projectId) ||
          !kinds.includes(kind) ||
          (kind !== 'modpack' && (!profile || (kind === 'mod' && profile.loader === 'vanilla')))
        )
          return;
        await perform(async (current) => {
          if (kind === 'modpack') await owner.services.api.enqueuePack(projectId, true);
          else await owner.services.api.enqueueContent(value!.profileKey, projectId, kind);
          if (current()) owner.services.launcher.notify(i18n.t('content.queued'));
        });
      },
      importPack: async () => {
        if (!canMutate()) return;
        requests.picking = true;
        await perform(async (current) => {
          const path = await owner.services.api.choosePack();
          if (!current()) return;
          requests.picking = false;
          if (!path || !current() || !owner.services.api.desktop || domainBlocked(owner.services))
            return;
          await owner.services.api.enqueuePack(path, false);
          if (current()) owner.services.launcher.notify(i18n.t('content.queued'));
        });
      },
      exportInstance: async () => {
        const value = identity(),
          includeSaves = owner.state.includeSaves;
        if (!canMutate() || !value) return;
        await perform(async (current) => {
          if (
            (await owner.services.api.exportInstance(value.profileKey, includeSaves)) &&
            current()
          )
            owner.services.launcher.notify(i18n.t('content.exported'));
        });
      },
      setIncludeSaves: (includeSaves) => {
        if (owner.mounted) owner.commit({ ...owner.state, includeSaves });
      },
    }),
  );
  useEffect(() => {
    if (!owner.mounted) return;
    const config = owner.services.launcher.getGuardState().config,
      target = navigationTarget();
    if (target.stamp !== requests.navigation) {
      requests.navigation = target.stamp;
      if (target.explicit) {
        requests.initialized = true;
        requests.explicitEmpty = target.key === null;
        owner.commit({ ...owner.state, selectedProfileKey: target.key, removing: null });
      }
    }
    if (
      config &&
      !target.detail &&
      (!requests.initialized || (owner.state.selectedProfileKey !== null && !identity()))
    ) {
      requests.initialized = true;
      const selectedProfileKey = requests.explicitEmpty
        ? null
        : (config.profiles.find((profile) => profile.instance_key === config.active_profile)
            ?.instance_key ??
          config.profiles[0]?.instance_key ??
          null);
      owner.commit({ ...owner.state, selectedProfileKey });
      invalidateList();
    }
    if (
      (owner.state.list && !sameIdentity(owner.state.list)) ||
      (owner.state.listRequest && !sameIdentity(owner.state.listRequest))
    )
      invalidateList();
    void requestList();
  });
  return {
    get snapshot() {
      const list =
        owner.state.list &&
        sameIdentity({
          profileKey: owner.state.list.profileKey,
          directory: owner.state.list.directory,
          category: owner.state.list.category,
        })
          ? owner.state.list
          : null;
      return {
        ...owner.state,
        selectedProfileKey: selectedKey(),
        list,
        listRequest:
          owner.state.listRequest && sameIdentity(owner.state.listRequest)
            ? owner.state.listRequest
            : null,
        removing: list ? owner.state.removing : null,
      };
    },
    actions,
    // Private interaction projection; public snapshots contain only the brief fields.
    get picking() {
      return owner.mounted && requests.operationGeneration === owner.generation && requests.picking;
    },
  };
}
