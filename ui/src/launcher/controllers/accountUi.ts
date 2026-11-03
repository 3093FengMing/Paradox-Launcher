import { useCallback, useEffect, useState } from 'react';
import type { AccountUiSnapshot, LauncherActions } from '../public/types';
import type { LauncherServices } from '../services';
import { domainBlocked, useControllerOwner } from './owner';
const reconnect = (state: AccountUiSnapshot): AccountUiSnapshot => ({
  ...state,
  promptActionPending: null,
});
export function useAccountUiController(services: LauncherServices): {
  snapshot: AccountUiSnapshot;
  actions: LauncherActions['accounts'];
} {
  const owner = useControllerOwner<AccountUiSnapshot>(
    services,
    {
      clientIdDraft: services.accounts.state.client_id,
      removingId: null,
      promptActionPending: null,
      promptExpired: false,
    },
    reconnect,
  );
  const [requests] = useState(() => ({
    prompt: null as string | null,
    token: null as symbol | null,
    clientId: services.accounts.state.client_id,
  }));
  const syncPrompt = useCallback(() => {
    const id = owner.services.accounts.getLaunchState().prompt?.id ?? null;
    if (id !== requests.prompt) {
      requests.prompt = id;
      requests.token = null;
      owner.commit({ ...owner.state, promptActionPending: null });
    }
  }, [owner, requests]);
  const allowed = (desktop = true) => {
    const accounts = owner.services.accounts.getLaunchState();
    return (
      owner.mounted &&
      (!desktop || owner.services.api.desktop) &&
      !domainBlocked(owner.services) &&
      accounts.ready &&
      !accounts.pending
    );
  };
  const promptAction = async (kind: 'open' | 'copy') => {
    syncPrompt();
    const account = owner.services.accounts.getLaunchState(),
      prompt = account.prompt;
    if (
      !owner.mounted ||
      !owner.services.api.desktop ||
      !prompt ||
      account.cancelling ||
      requests.token
    )
      return;
    if (prompt.expires_at <= Date.now() / 1000) {
      owner.services.launcher.reportError('auth.errors.expired');
      return;
    }
    const token = Symbol(),
      generation = owner.generation,
      accountGeneration = account.generation;
    requests.token = token;
    owner.commit({ ...owner.state, promptActionPending: kind });
    const current = () =>
      owner.mounted &&
      generation === owner.generation &&
      owner.services.accounts.getLaunchState().generation === accountGeneration &&
      owner.services.accounts.getLaunchState().prompt?.id === prompt.id;
    try {
      if (kind === 'open') await owner.services.api.openLoginPage(prompt.id);
      else await navigator.clipboard.writeText(prompt.user_code);
    } catch (error) {
      if (current()) owner.services.launcher.reportError(error);
    } finally {
      if (requests.token === token) {
        requests.token = null;
        if (current()) owner.commit({ ...owner.state, promptActionPending: null });
      }
    }
  };
  const [actions] = useState<LauncherActions['accounts']>(() =>
    Object.freeze({
      reload: () =>
        owner.mounted && !domainBlocked(owner.services)
          ? owner.services.accounts.reload()
          : Promise.resolve(false),
      login: () =>
        allowed() && !!owner.services.accounts.getLaunchState().state.client_id
          ? owner.services.accounts.login()
          : Promise.resolve(false),
      configure: (id) =>
        allowed() && !!id.trim() ? owner.services.accounts.configure(id) : Promise.resolve(false),
      select: (id) =>
        allowed() &&
        (id === null ||
          owner.services.accounts
            .getLaunchState()
            .state.accounts.some((account) => account.id === id))
          ? owner.services.accounts.select(id)
          : Promise.resolve(false),
      refresh: (id) =>
        allowed() &&
        owner.services.accounts.getLaunchState().state.accounts.some((account) => account.id === id)
          ? owner.services.accounts.refresh(id)
          : Promise.resolve(false),
      clearRecovery: (id) =>
        allowed() && owner.services.accounts.recovery.includes(id)
          ? owner.services.accounts.clearRecovery(id)
          : Promise.resolve(false),
      patchClientId: (clientIdDraft) => {
        if (owner.mounted) owner.commit({ ...owner.state, clientIdDraft });
      },
      beginLogout: (removingId) => {
        if (
          allowed() &&
          owner.services.accounts
            .getLaunchState()
            .state.accounts.some((account) => account.id === removingId)
        )
          owner.commit({ ...owner.state, removingId });
      },
      cancelLogout: () => {
        if (owner.mounted && !owner.services.accounts.getLaunchState().pending)
          owner.commit({ ...owner.state, removingId: null });
      },
      confirmLogout: async () => {
        const id = owner.state.removingId;
        if (
          !id ||
          !allowed() ||
          !owner.services.accounts
            .getLaunchState()
            .state.accounts.some((account) => account.id === id)
        )
          return false;
        const generation = owner.generation;
        const ok = await owner.services.accounts.logout(id);
        if (!owner.mounted || generation !== owner.generation) return false;
        if (ok && owner.state.removingId === id) owner.commit({ ...owner.state, removingId: null });
        return ok;
      },
      cancelLogin: () => (owner.mounted ? owner.services.accounts.cancel() : Promise.resolve()),
      openLoginPage: () => promptAction('open'),
      copyLoginCode: () => promptAction('copy'),
      saveOfflineName: () =>
        allowed(false) ? owner.services.launcher.saveAccount() : Promise.resolve(false),
    }),
  );
  const promptId = services.accounts.prompt?.id;
  useEffect(() => {
    syncPrompt();
    const tick = () => {
      const prompt = owner.services.accounts.getLaunchState().prompt;
      owner.commit({
        ...owner.state,
        promptExpired: !!prompt && prompt.expires_at <= Date.now() / 1000,
      });
    };
    tick();
    if (!promptId) return;
    const timer = window.setInterval(() => {
      const prompt = owner.services.accounts.getLaunchState().prompt;
      const promptExpired = !!prompt && prompt.expires_at <= Date.now() / 1000;
      if (promptExpired !== owner.state.promptExpired)
        owner.commit({ ...owner.state, promptExpired });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [owner, requests, promptId, syncPrompt]);
  useEffect(() => {
    const clientId = owner.services.accounts.getLaunchState().state.client_id;
    if (clientId !== requests.clientId) {
      requests.clientId = clientId;
      owner.commit({ ...owner.state, clientIdDraft: clientId });
    }
  }, [owner, requests, services.accounts.state.client_id]);
  return {
    get snapshot() {
      return {
        ...owner.state,
        promptExpired:
          !!owner.services.accounts.getLaunchState().prompt &&
          owner.services.accounts.getLaunchState().prompt!.expires_at <= Date.now() / 1000,
      };
    },
    actions,
  };
}
