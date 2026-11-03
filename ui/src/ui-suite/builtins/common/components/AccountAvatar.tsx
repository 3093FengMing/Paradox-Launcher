import '../styles/common.css';
import { useLauncherSnapshot } from '@paradox/launcher';
import { viewProps } from '../lib/view';
import '../styles/account-avatar.css';
function AccountAvatar(input?: {
  props?: Readonly<Record<string, unknown>>;
  accountId?: string;
  account?: {
    id: string;
    name: string;
  } | null;
  name?: string;
  className?: string;
}) {
  const snapshot = useLauncherSnapshot();
  const value = viewProps<{
    accountId?: string;
    account?: {
      id: string;
      name: string;
    } | null;
    name?: string;
    className?: string;
  }>(input);
  const id = value.accountId ?? value.account?.id,
    account = snapshot.accounts.state.accounts.find((item) => item.id === id),
    name = value.name ?? account?.name ?? '',
    className = value.className ?? '',
    image = id ? snapshot.avatars[id] : null;
  return (
    <span
      className={`avatar account-avatar ${className}`}
      aria-hidden="true"
      data-ui-site="AccountAvatar-1"
    >
      {image ? (
        <img src={image} alt="" data-ui-site="AccountAvatar-2" />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
export default AccountAvatar;
