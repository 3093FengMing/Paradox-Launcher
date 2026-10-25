import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  return (
    <div className="account-grid">
      <Panel className="account-detail">
        <div className="card-eyebrow">
          {t('accounts.offlineIdentity')}
          <Badge>{t('accounts.enabled')}</Badge>
        </div>
        <div className="account-title">
          <div className="avatar large">{username.slice(0, 1).toUpperCase()}</div>
          <div>
            <h2>{username}</h2>
            <p>{t('accounts.localIdentity')}</p>
          </div>
        </div>
        <Field label={t('accounts.playerName')} description={t('accounts.nameDescription')}>
          <input
            value={draftUsername}
            onChange={(event) => onUsernameChange(event.target.value)}
            maxLength={16}
          />
        </Field>
        <p className="help-text">{t('accounts.offlineHelp')}</p>
        <button className="primary" disabled={!!busy || saving} onClick={() => onSave()}>
          <Check size={17} />
          {t('accounts.save')}
        </button>
      </Panel>
      <Panel className="planned-card">
        <div className="microsoft-mark">
          <i />
          <i />
          <i />
          <i />
        </div>
        <h2>{t('accounts.microsoft')}</h2>
        <Badge muted>Roadmap · v0.3</Badge>
        <p>{t('accounts.microsoftDescription')}</p>
        <button className="secondary" onClick={() => onRoadmap()}>
          {t('accounts.roadmap')}
          <ArrowRight size={16} />
        </button>
      </Panel>
    </div>
  );
}
