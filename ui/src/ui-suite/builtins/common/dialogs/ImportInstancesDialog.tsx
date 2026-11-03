import '../styles/common.css';
import { sourceView } from '../lib/view';
import { useTranslation } from 'react-i18next';
import { Folder, Import, LoaderCircle, Search } from 'lucide-react';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import DefaultLauncherDialog from '../dialogs/LauncherDialog';
import { Badge, Field } from '@paradox/ui';
function ImportInstancesDialog() {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot();
  const actions = useLauncherActions().importDraft;
  const { directory, instances, selected, scanning, picking, pending, canSubmit } =
    snapshot.importDraft;
  const saving = snapshot.settings.saving || pending;
  const desktop = snapshot.window.desktop;
  const onClose = actions.cancel;
  if (!snapshot.importDraft.open) return null;
  return (
    <LauncherDialog
      pending={saving || scanning || picking}
      onClose={onClose}
      title={t('importDialog.title')}
      description={t('importDialog.description')}
      data-ui-site="ImportInstancesDialog-1"
    >
      {!desktop && (
        <p data-ui-site="ImportInstancesDialog-2">{t('importDialog.desktopRequired')}</p>
      )}
      <Field label={t('importDialog.gameRoot')} data-ui-site="ImportInstancesDialog-3">
        <input
          disabled={saving || scanning || picking || !desktop}
          value={directory}
          onChange={(event) => actions.setDirectory(event.target.value)}
          placeholder={t('importDialog.rootPlaceholder')}
          data-ui-site="ImportInstancesDialog-4"
        />
      </Field>
      <div className="button-group" data-ui-site="ImportInstancesDialog-5">
        <button
          className="secondary"
          disabled={!desktop || saving || scanning || picking}
          onClick={() => {
            void actions.chooseDirectory();
          }}
          data-ui-site="ImportInstancesDialog-6"
        >
          <Folder size={16} data-ui-site="ImportInstancesDialog-7" />
          {t('importDialog.chooseDirectory')}
        </button>
        <button
          className="secondary"
          disabled={!desktop || !directory.trim() || scanning || saving || picking}
          onClick={() => {
            void actions.scan();
          }}
          data-ui-site="ImportInstancesDialog-8"
        >
          <Search size={16} data-ui-site="ImportInstancesDialog-9" />
          {scanning ? t('importDialog.scanning') : t('importDialog.scan')}
        </button>
      </div>
      {instances !== null && (
        <div className="profile-list" data-ui-site="ImportInstancesDialog-10">
          {instances.length ? (
            instances.map((instance) => (
              <label
                className="profile-card"
                key={instance.instance_key}
                data-ui-site="ImportInstancesDialog-11"
              >
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
                  data-ui-site="ImportInstancesDialog-12"
                />
                <div className="profile-info" data-ui-site="ImportInstancesDialog-13">
                  <h3 data-ui-site="ImportInstancesDialog-14">{instance.instance_key}</h3>
                  <p data-ui-site="ImportInstancesDialog-15">
                    {instance.game_version ?? t('importDialog.unknownVersion')} · {instance.loader}
                  </p>
                </div>
                <Badge
                  muted={instance.loader !== 'vanilla'}
                  data-ui-site="ImportInstancesDialog-16"
                >
                  {instance.loader === 'vanilla'
                    ? t('importDialog.vanilla')
                    : t('importDialog.unsupported')}
                </Badge>
              </label>
            ))
          ) : (
            <p data-ui-site="ImportInstancesDialog-17">{t('importDialog.empty')}</p>
          )}
        </div>
      )}
      <div className="modal-buttons" data-ui-site="ImportInstancesDialog-18">
        <button
          className="secondary"
          disabled={saving || scanning || picking}
          onClick={onClose}
          data-ui-site="ImportInstancesDialog-19"
        >
          {t('common.cancel')}
        </button>
        <button
          className="primary"
          disabled={!canSubmit}
          onClick={() => {
            void actions.submit();
          }}
          data-ui-site="ImportInstancesDialog-20"
        >
          {saving ? (
            <LoaderCircle className="spin" size={16} data-ui-site="ImportInstancesDialog-21" />
          ) : (
            <Import size={16} data-ui-site="ImportInstancesDialog-22" />
          )}
          {t('importDialog.importCount', { count: selected.length })}
        </button>
      </div>
    </LauncherDialog>
  );
}
export default ImportInstancesDialog;
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
