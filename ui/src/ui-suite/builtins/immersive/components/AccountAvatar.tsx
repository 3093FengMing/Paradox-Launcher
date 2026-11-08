import { useLauncherSnapshot } from '@paradox/launcher';
import { viewProps } from '../../common/lib/view';
type AvatarProps = { accountId?: string; account?: { id: string; name: string } | null; name?: string; className?: string };
export default function AccountAvatar(input?: AvatarProps & { props?: Readonly<Record<string, unknown>> }) {
  const s = useLauncherSnapshot(), value = viewProps<AvatarProps>(input);
  const id = value.accountId ?? value.account?.id;
  const name = value.name ?? value.account?.name ?? '';
  const image = id ? s.avatars[id] : null;
  return <span data-ui-site="AccountAvatar-1" className={`avatar account-avatar ${value.className ?? ''}`} aria-hidden="true">
    {image ? <img data-ui-site="AccountAvatar-2" src={image} alt="" /> : name.slice(0, 1).toUpperCase()}
  </span>;
}
