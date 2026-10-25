import { ArrowRight, Check } from 'lucide-react';
import { Badge, Field, Panel } from '../components/ui';

interface AccountsPageProps {
  username: string;
  draftUsername: string;
  busy: boolean;
  saving: boolean;
  onUsernameChange: (value: string) => void;
  onSave: () => void;
  onRoadmap: () => void;
}

export default function AccountsPage({
  username,
  draftUsername,
  busy,
  saving,
  onUsernameChange,
  onSave,
  onRoadmap,
}: AccountsPageProps) {
  return (
    <div className="account-grid">
      <Panel className="account-detail">
        <div className="card-eyebrow">
          离线身份<Badge>已启用</Badge>
        </div>
        <div className="account-title">
          <div className="avatar large">{username.slice(0, 1).toUpperCase()}</div>
          <div>
            <h2>{username}</h2>
            <p>Offline · 本地游戏身份</p>
          </div>
        </div>
        <Field label="玩家名称" description="3–16 位英文字母、数字或下划线">
          <input
            value={draftUsername}
            onChange={(event) => onUsernameChange(event.target.value)}
            maxLength={16}
          />
        </Field>
        <p className="help-text">
          离线账户用于本地游玩；需要正版验证的服务器请使用 Microsoft 账户。
        </p>
        <button className="primary" disabled={!!busy || saving} onClick={() => onSave()}>
          <Check size={17} />
          保存账户
        </button>
      </Panel>
      <Panel className="planned-card">
        <div className="microsoft-mark">
          <i />
          <i />
          <i />
          <i />
        </div>
        <h2>Microsoft 账户</h2>
        <Badge muted>Roadmap · v0.3</Badge>
        <p>
          设备代码登录、令牌安全存储
          <br />与 Minecraft 正版权限验证。
        </p>
        <button className="secondary" onClick={() => onRoadmap()}>
          查看开发计划
          <ArrowRight size={16} />
        </button>
      </Panel>
    </div>
  );
}
