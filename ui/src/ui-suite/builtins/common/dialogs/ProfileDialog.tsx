import '../styles/common.css';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useRef } from 'react';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import type { GameProfile } from '@paradox/launcher';
import { Box, LayoutGrid, LoaderCircle, Plus, X } from 'lucide-react';
import { Badge, Dialog, Field, Input, Select } from '@paradox/ui';
function ProfileDialog() {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot();
  const actions = useLauncherActions().profileDraft;
  const { theme, variables } = snapshot.appearance,
    reduceMotion = snapshot.appearance.value?.reduce_motion ?? false,
    keyboardNavigation = snapshot.appearance.personalization.shortcuts;
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
      data-ui-site="ProfileDialog-1"
    >
      <Dialog.Portal data-ui-site="ProfileDialog-2">
        <div
          className={`dialog-theme ${reduceMotion ? 'reduce-motion' : ''} ${keyboardNavigation ? 'keyboard-navigation' : ''}`}
          data-theme={theme}
          style={variables}
          data-ui-site="ProfileDialog-3"
        >
          <Dialog.Backdrop className="modal-backdrop" data-ui-site="ProfileDialog-4" />
          <Dialog.Popup className="modal" initialFocus={nameInput} data-ui-site="ProfileDialog-5">
            {editor && (
              <Fragment data-ui-site="ProfileDialog-6">
                <div className="modal-heading" data-ui-site="ProfileDialog-7">
                  <div className="metric-icon" data-ui-site="ProfileDialog-8">
                    <Box size={23} data-ui-site="ProfileDialog-9" />
                  </div>
                  <button
                    className="icon-button"
                    aria-label={t('common.closeDialog')}
                    disabled={saving}
                    onClick={onClose}
                    data-ui-site="ProfileDialog-10"
                  >
                    <X size={19} data-ui-site="ProfileDialog-11" />
                  </button>
                </div>
                <Dialog.Title className="modal-title" data-ui-site="ProfileDialog-12">
                  {editor.editKey ? t('instances.rename') : t('profileDialog.createTitle')}
                </Dialog.Title>
                <Dialog.Description className="modal-description" data-ui-site="ProfileDialog-13">
                  {editor.editKey
                    ? t('profileDialog.renameDescription')
                    : t('profileDialog.createDescription')}
                </Dialog.Description>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (canSave) onSave();
                  }}
                  data-ui-site="ProfileDialog-14"
                >
                  <Field label={t('instances.name')} data-ui-site="ProfileDialog-15">
                    <Input
                      ref={nameInput}
                      id="profile-name"
                      required
                      disabled={saving}
                      placeholder={t('profileDialog.namePlaceholder')}
                      maxLength={64}
                      value={editor.name}
                      onChange={(event) => onChange({ name: event.target.value })}
                      data-ui-site="ProfileDialog-16"
                    />
                  </Field>
                  <Field label={t('common.minecraftVersion')} data-ui-site="ProfileDialog-17">
                    <input
                      required
                      disabled={saving || !!editor.editKey}
                      value={editor.version}
                      onChange={(event) => onChange({ version: event.target.value })}
                      data-ui-site="ProfileDialog-18"
                    />
                  </Field>
                  {!editor.editKey && (
                    <Fragment data-ui-site="ProfileDialog-19">
                      <Field
                        label={t('loaders.type')}
                        description={loader === 'forge' ? t('loaders.forgeRange') : undefined}
                        data-ui-site="ProfileDialog-20"
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
                          data-ui-site="ProfileDialog-21"
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
                          data-ui-site="ProfileDialog-22"
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
                            data-ui-site="ProfileDialog-23"
                          />
                        </Field>
                      )}
                    </Fragment>
                  )}
                  <div className="modal-type" data-ui-site="ProfileDialog-24">
                    <LayoutGrid size={17} data-ui-site="ProfileDialog-25" />
                    <span data-ui-site="ProfileDialog-26">
                      {loader === 'vanilla' ? t('common.vanilla') : loader}
                    </span>
                    <Badge data-ui-site="ProfileDialog-27">{t('common.supported')}</Badge>
                  </div>
                  <div className="modal-buttons" data-ui-site="ProfileDialog-28">
                    <button
                      type="button"
                      className="secondary"
                      disabled={saving}
                      onClick={onClose}
                      data-ui-site="ProfileDialog-29"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="submit"
                      className="primary"
                      disabled={!canSave}
                      data-ui-site="ProfileDialog-30"
                    >
                      {saving ? (
                        <LoaderCircle className="spin" size={16} data-ui-site="ProfileDialog-31" />
                      ) : (
                        <Plus size={16} data-ui-site="ProfileDialog-32" />
                      )}
                      {editor.editKey ? t('profileDialog.saveName') : t('common.createInstance')}
                    </button>
                  </div>
                </form>
              </Fragment>
            )}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export default ProfileDialog;
