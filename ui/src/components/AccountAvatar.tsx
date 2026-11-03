import { customComponent } from '../customization/Customizable';
import { useAccountAvatar } from '../hooks/useAccountAvatar';
import type { MicrosoftAccount } from '../types';
import './account-avatar.css';

interface AccountAvatarProps {
  account?: MicrosoftAccount | null;
  name: string;
  className?: string;
}

function AccountAvatar({ account, name, className = '' }: AccountAvatarProps) {
  const image = useAccountAvatar(account);
  return (
    <span className={`avatar account-avatar ${className}`} aria-hidden="true">
      {image ? <img src={image} alt="" /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

const CustomizedAccountAvatar = customComponent('component.account-avatar', AccountAvatar);
export default CustomizedAccountAvatar;
