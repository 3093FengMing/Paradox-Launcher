import { customComponent } from '../customization/Customizable';
import { useTranslation } from 'react-i18next';
import { Folder, Import, LoaderCircle, Search } from 'lucide-react';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import LauncherDialog, { type DialogAppearance } from './LauncherDialog';
import { Badge, Field } from './ui';

function ImportInstancesDialog(appearance: DialogAppearance) {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot();
  const actions = useLauncherActions().importDraft;
  const { directory, instances, selected, scanning, picking, pending, canSubmit } =
    snapshot.importDraft;
  const saving = snapshot.settings.saving || pending;
  const desktop = snapshot.window.desktop;
  const onClose = actions.cancel;
  return (
    <LauncherDialog
      {...appearance}
      pending={saving || scanning || picking}
      onClose={onClose}
      title={t('importDialog.title')}
      description={t('importDialog.description')}
    >
      {!desktop && <p>{t('importDialog.desktopRequired')}</p>}
      <Field label={t('importDialog.gameRoot')}>
        <input
          disabled={saving || scanning || picking || !desktop}
          value={directory}
          onChange={(event) => actions.setDirectory(event.target.value)}
          placeholder={t('importDialog.rootPlaceholder')}
        />
      </Field>
      <div className="button-group">
        <button
          className="secondary"
          disabled={!desktop || saving || scanning || picking}
          onClick={() => {
            void actions.chooseDirectory();
          }}
        >
          <Folder size={16} />
          {t('importDialog.chooseDirectory')}
        </button>
        <button
          className="secondary"
          disabled={!desktop || !directory.trim() || scanning || saving || picking}
          onClick={() => {
            void actions.scan();
          }}
        >
          <Search size={16} />
          {scanning ? t('importDialog.scanning') : t('importDialog.scan')}
        </button>
      </div>
      {instances !== null && (
        <div className="profile-list">
          {instances.length ? (
            instances.map((instance) => (
              <label className="profile-card" key={instance.instance_key}>
                <input
                  type="checkbox"
                  disabled={saving || instance.loader !== 'vanilla' || !instance.game_version}
                  checked={selected.includes(instance.instance_key)}
                  onChange={(event) =>
                    actions.setSelected(
                      event.target.checked
                        ? [...selected, instance.instance_key]
                        : selected.filter((key) => key !== instance.instance_key),
                    )
                  }
                />
                <div className="profile-info">
                  <h3>{instance.instance_key}</h3>
                  <p>
                    {instance.game_version ?? t('importDialog.unknownVersion')} · {instance.loader}
                  </p>
                </div>
                <Badge muted={instance.loader !== 'vanilla'}>
                  {instance.loader === 'vanilla'
                    ? t('importDialog.vanilla')
                    : t('importDialog.unsupported')}
                </Badge>
              </label>
            ))
          ) : (
            <p>{t('importDialog.empty')}</p>
          )}
        </div>
      )}
      <div className="modal-buttons">
        <button className="secondary" disabled={saving || scanning || picking} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          className="primary"
          disabled={!canSubmit}
          onClick={() => {
            void actions.submit();
          }}
        >
          {saving ? <LoaderCircle className="spin" size={16} /> : <Import size={16} />}
          {t('importDialog.importCount', { count: selected.length })}
        </button>
      </div>
    </LauncherDialog>
  );
}

const CustomizedImportInstancesDialog = customComponent(
  'component.import-instances-dialog',
  ImportInstancesDialog,
);
export default CustomizedImportInstancesDialog;
