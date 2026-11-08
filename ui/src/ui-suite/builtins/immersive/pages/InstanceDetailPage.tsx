import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { UiIdentity, UiView } from '@paradox/ui';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import InstanceDetail from '../components/InstanceDetail';
import AppSidebar from '../components/AppSidebar';
import '../styles/instance-detail.css';
export default function InstanceDetailPage() {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  const key = s.navigation.params.profileKey;
  const entry = s.profiles.items.find(item => item.profile.instance_key === key);
  const exists = !!entry;
  const [presentation, setPresentation] = useState<{ key?: string; section: string }>({ section: 'overview' });
  const section = presentation.key === key ? presentation.section : 'overview';
  const chooseSection = (value: string) => { if (['overview', 'settings', 'mods', 'resourcepacks', 'shaderpacks', 'saves'].includes(value)) setPresentation({ key, section: value }); };
  useEffect(() => { if (exists && key) a.content.selectProfile(key); }, [a, key, exists]);
  if (!entry || !key) return <UiView data-ui-site="InstanceDetailPage-missing" id="component.instance-detail" props={{ profileKey: key }} Original={InstanceDetail}/>;
  return <UiIdentity namespace="profile" value={key}><div data-ui-site="InstanceDetailPage-root" className="instance-detail-page immersive-detail-page">
    <UiView data-ui-site="InstanceDetailPage-sidebar" id="component.app-sidebar" props={{ profileKey: key, detailSection: section, onDetailSectionChange: chooseSection }} Original={AppSidebar}/>
    <div data-ui-site="InstanceDetailPage-main" className="instance-detail-main"><button data-ui-site="InstanceDetailPage-back" className="text-button instance-back" onClick={() => a.navigation.navigate('instances')}><ArrowLeft data-ui-site="InstanceDetailPage-back-icon" size={15}/>{t('instancePages.back')}</button>
      <nav data-ui-site="InstanceDetailPage-tabs" className="instance-detail-tabs" aria-label={t('shellHome.instanceSections')}>{['overview', 'settings', 'mods', 'resourcepacks', 'shaderpacks', 'saves'].map(value => <button data-ui-site="InstanceDetailPage-tab" className={section === value ? 'active' : ''} key={value} aria-pressed={section === value} onClick={() => chooseSection(value)}>{t(`shellHome.sections.${value}`)}</button>)}</nav>
      <UiView data-ui-site="InstanceDetailPage-detail" id="component.instance-detail" props={{ profileKey: key, detailSection: section, onDetailSectionChange: chooseSection }} Original={InstanceDetail}/>
    </div>
  </div></UiIdentity>;
}
