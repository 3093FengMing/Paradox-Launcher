import { useLauncherSnapshot } from '@paradox/launcher';
import type { MicrosoftAccount } from '../types';

export function useAccountAvatar(
  account: Pick<MicrosoftAccount, 'id' | 'skin_url'> | null | undefined,
): string | null {
  const snapshot = useLauncherSnapshot();
  const current =
    account &&
    snapshot.accounts.state.accounts.find(
      (value) => value.id === account.id && value.skin_url === account.skin_url,
    );
  return current ? (snapshot.avatars[current.id] ?? null) : null;
}
