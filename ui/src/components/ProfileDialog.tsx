import { customComponent } from '../customization/Customizable';
import { useTranslation } from 'react-i18next';
import { useRef, type CSSProperties } from 'react';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import type { GameProfile } from '../types';
import { Box, LayoutGrid, LoaderCircle, Plus, X } from 'lucide-react';
import { Badge, Dialog, Field, Input, Select } from './ui';

interface ProfileDialogProps {
  theme: 'light' | 'dark';
  variables: CSSProperties;
  reduceMotion: boolean;
  keyboardNavigation: boolean;
}

function ProfileDialog({ theme, variables, reduceMotion, keyboardNavigation }: ProfileDialogProps) {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot();
  const actions = useLauncherActions().profileDraft;
  const { editor, pending, canSubmit: canSave, loaderCatalog } = snapshot.profileDraft;
  const saving = snapshot.settings.saving || pending;
  const loading = loaderCatalog.pending;
  const loaderError = loaderCatalog.error;
  const onChange = actions.patch;
  const onClose = actions.cancel;
  const onSave = () => {
    void actions.submit();
  };
  const nameInput = useRef<HTMLInputElement>(null);
  const loader = editor?.loader ?? 'vanilla';
  const loaders =
    loaderCatalog.request?.loader === loader && loaderCatalog.request.game === editor?.version
      ? loaderCatalog.versions
      : [];
  return (
    <Dialog.Root
      data-ui-modal-boundary
      open={editor !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Dialog.Portal>
        <div
          className={`dialog-theme ${reduceMotion ? 'reduce-motion' : ''} ${keyboardNavigation ? 'keyboard-navigation' : ''}`}
          data-theme={theme}
          data-ui-root
          style={variables}
        >
          <Dialog.Backdrop className="modal-backdrop" />
          <Dialog.Popup className="modal" initialFocus={nameInput}>
            {editor && (
              <>
                <div className="modal-heading">
                  <div className="metric-icon">
                    <Box size={23} />
                  </div>
                  <button
                    className="icon-button"
                    aria-label={t('common.closeDialog')}
                    disabled={saving}
                    onClick={onClose}
                  >
                    <X size={19} />
                  </button>
                </div>
                <Dialog.Title className="modal-title">
                  {editor.editKey ? t('instances.rename') : t('profileDialog.createTitle')}
                </Dialog.Title>
                <Dialog.Description className="modal-description">
                  {editor.editKey
                    ? t('profileDialog.renameDescription')
                    : t('profileDialog.createDescription')}
                </Dialog.Description>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (canSave) onSave();
                  }}
                >
                  <Field label={t('instances.name')}>
                    <Input
                      ref={nameInput}
                      id="profile-name"
                      required
                      disabled={saving}
                      placeholder={t('profileDialog.namePlaceholder')}
                      maxLength={64}
                      value={editor.name}
                      onChange={(event) => onChange({ name: event.target.value })}
                    />
                  </Field>
                  <Field label={t('common.minecraftVersion')}>
                    <input
                      required
                      disabled={saving || !!editor.editKey}
                      value={editor.version}
                      onChange={(event) => onChange({ version: event.target.value })}
                    />
                  </Field>
                  {!editor.editKey && (
                    <>
                      <Field
                        label={t('loaders.type')}
                        description={loader === 'forge' ? t('loaders.forgeRange') : undefined}
                      >
                        <Select
                          value={loader}
                          disabled={saving}
                          onValueChange={(value) =>
                            onChange({
                              loader: value as GameProfile['loader'],
                            })
                          }
                          options={['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].map(
                            (value) => ({
                              value,
                              label:
                                value === 'vanilla'
                                  ? t('common.vanilla')
                                  : value === 'neoforge'
                                    ? 'NeoForge'
                                    : value[0].toUpperCase() + value.slice(1),
                            }),
                          )}
                        />
                      </Field>
                      {loader !== 'vanilla' && (
                        <Field
                          label={t('loaders.version')}
                          description={
                            loaderError ||
                            (loading
                              ? t('loaders.loading')
                              : loaders.length === 0
                                ? t('loaders.empty')
                                : t('loaders.compatibility'))
                          }
                        >
                          <Select
                            required
                            disabled={saving || loading}
                            value={editor.loader_version ?? ''}
                            onValueChange={(value) => onChange({ loader_version: value })}
                            options={[
                              { value: '', label: t('loaders.choose') },
                              ...loaders.map((item) => ({
                                value: item.version,
                                label: `${item.version}${item.stable ? '' : ` · ${t('loaders.experimental')}`}`,
                              })),
                            ]}
                          />
                        </Field>
                      )}
                    </>
                  )}
                  <div className="modal-type">
                    <LayoutGrid size={17} />
                    <span>{loader === 'vanilla' ? t('common.vanilla') : loader}</span>
                    <Badge>{t('common.supported')}</Badge>
                  </div>
                  <div className="modal-buttons">
                    <button type="button" className="secondary" disabled={saving} onClick={onClose}>
                      {t('common.cancel')}
                    </button>
                    <button type="submit" className="primary" disabled={!canSave}>
                      {saving ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
                      {editor.editKey ? t('profileDialog.saveName') : t('common.createInstance')}
                    </button>
                  </div>
                </form>
              </>
            )}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const CustomizedProfileDialog = customComponent('component.profile-dialog', ProfileDialog);
export default CustomizedProfileDialog;
