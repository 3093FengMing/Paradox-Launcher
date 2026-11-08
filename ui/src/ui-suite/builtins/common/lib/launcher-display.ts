import type { DeepReadonly, LauncherSnapshot } from '@paradox/launcher';

export type ActiveAccountDisplay = {
  account: DeepReadonly<LauncherSnapshot['accounts']['state']['accounts'][number]> | null;
  name: string;
  kind: 'microsoft' | 'offline';
};

export function resolveActiveAccount(
  snapshot: DeepReadonly<LauncherSnapshot>,
): ActiveAccountDisplay {
  const account =
    snapshot.accounts.state.accounts.find((item) => item.id === snapshot.accounts.state.active) ??
    null;
  return {
    account,
    name: account?.name ?? snapshot.config.value?.settings.offline_username ?? '',
    kind: account ? 'microsoft' : 'offline',
  };
}

export function resolveProfileEntry(
  snapshot: DeepReadonly<LauncherSnapshot>,
  key: string | null,
): DeepReadonly<LauncherSnapshot['profiles']['items'][number]> | null {
  return snapshot.profiles.items.find((item) => item.profile.instance_key === key) ?? null;
}
