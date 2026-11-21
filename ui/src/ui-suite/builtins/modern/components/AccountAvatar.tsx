import { useState } from 'react';
import { UserRound } from 'lucide-react';
import { useLauncherSnapshot } from '@paradox/launcher';
import { viewProps } from '../../common/lib/view';
type AvatarProps = { accountId?: string; account?: { id: string; name: string } | null; name?: string; className?: string };
export default function AccountAvatar(input?: AvatarProps & { props?: Readonly<Record<string, unknown>> }) {
  const s = useLauncherSnapshot(), value = viewProps<AvatarProps>(input);
  const id = value.accountId ?? value.account?.id;
  const name = value.name ?? value.account?.name ?? '';
  const image = id ? s.avatars[id] : null;
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const trimmed = name.trim();
  const initial = (typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed))[0]?.segment
    : Array.from(trimmed)[0])?.toLocaleUpperCase();
  return <span data-ui-site="AccountAvatar-1" className={`avatar account-avatar ${value.className ?? ''}`} aria-hidden="true">
    {image && image !== failedImage ? <img data-ui-site="AccountAvatar-2" src={image} alt="" onError={() => setFailedImage(image)} /> : initial || <UserRound data-ui-site="AccountAvatar-fallback-icon" size={18} aria-hidden="true" />}
  </span>;
}
