import { useTranslation } from 'react-i18next';
import { useRef, useState } from 'react';
import { Folder, Import, LoaderCircle, Search } from 'lucide-react';
import * as api from '../api';
import LauncherDialog, { type DialogAppearance } from './LauncherDialog';
import { Badge, Field } from './ui';
import type { InstalledInstance } from '../types';

interface Props extends DialogAppearance {
  saving: boolean;
  blocked: boolean;
  onClose: () => void;
  onError: (error: unknown) => void;
  onImport: (directory: string, keys: string[]) => Promise<boolean>;
}
export default function ImportInstancesDialog({
  saving,
  blocked,
  onClose,
  onError,
  onImport,
  ...appearance
}: Props) {
  const { t } = useTranslation();
  const [directory, setDirectory] = useState('');
  const [scannedDirectory, setScannedDirectory] = useState('');
  const [instances, setInstances] = useState<InstalledInstance[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const pending = useRef(false);
  const sequence = useRef(0);
  const scan = async (path = directory) => {
    const request = ++sequence.current;
    setScanning(true);
    try {
      const result = await api.scanImport(path);
      if (request !== sequence.current) return;
      setInstances(result);
      setScannedDirectory(path);
      setSelected(
        result
          .filter((instance) => instance.loader === 'vanilla' && instance.game_version)
          .map((instance) => instance.instance_key),
      );
    } catch (error) {
      if (request === sequence.current) onError(error);
    } finally {
      if (request === sequence.current) setScanning(false);
    }
  };
  const choose = async () => {
    try {
      const path = await api.chooseDirectory(t('importDialog.chooseRoot'));
      if (path) {
        setDirectory(path);
        await scan(path);
      }
    } catch (error) {
      onError(error);
    }
  };
  const submit = async () => {
    if (pending.current || !selected.length || scannedDirectory !== directory || blocked) return;
    pending.current = true;
    try {
      if (await onImport(scannedDirectory, selected)) onClose();
    } finally {
      pending.current = false;
    }
  };
  return (
    <LauncherDialog
      {...appearance}
      pending={saving || scanning}
      onClose={onClose}
      title={t('importDialog.title')}
      description={t('importDialog.description')}
    >
      {!api.desktop && <p>{t('importDialog.desktopRequired')}</p>}
      <Field label={t('importDialog.gameRoot')}>
        <input
          disabled={saving || scanning || !api.desktop}
          value={directory}
          onChange={(event) => {
            sequence.current++;
            setDirectory(event.target.value);
            setInstances(null);
            setSelected([]);
          }}
          placeholder={t('importDialog.rootPlaceholder')}
        />
      </Field>
      <div className="button-group">
        <button
          className="secondary"
          disabled={!api.desktop || saving || scanning}
          onClick={() => {
            void choose();
          }}
        >
          <Folder size={16} />
          {t('importDialog.chooseDirectory')}
        </button>
        <button
          className="secondary"
          disabled={!api.desktop || !directory.trim() || scanning || saving}
          onClick={() => {
            void scan();
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
                    setSelected((previous) =>
                      event.target.checked
                        ? [...previous, instance.instance_key]
                        : previous.filter((key) => key !== instance.instance_key),
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
        <button className="secondary" disabled={saving || scanning} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          className="primary"
          disabled={
            !api.desktop ||
            blocked ||
            saving ||
            scanning ||
            !selected.length ||
            directory !== scannedDirectory
          }
          onClick={() => {
            void submit();
          }}
        >
          {saving ? <LoaderCircle className="spin" size={16} /> : <Import size={16} />}
          {t('importDialog.importCount', { count: selected.length })}
        </button>
      </div>
    </LauncherDialog>
  );
}
