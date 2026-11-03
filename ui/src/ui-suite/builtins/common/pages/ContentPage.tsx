import '../styles/common.css';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FolderOpen, Package, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import type { ContentCategory, ContentKind } from '@paradox/launcher';
import { Badge, Field, Panel, Select } from '@paradox/ui';
function ContentPage() {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot();
  const actions = useLauncherActions().content;
  const config = snapshot.config.value;
  const {
    selectedProfileKey: selected,
    category,
    kind,
    query,
    request,
    results,
    list: content,
    pending,
    searching,
    removing,
    includeSaves,
  } = snapshot.content;
  if (!config) return null;
  const profile = config.profiles.find((profile) => profile.instance_key === selected);
  const entries = content?.entries ?? [];
  const desktop = snapshot.window.desktop;
  const disabled =
    !!snapshot.activity ||
    snapshot.settings.saving ||
    snapshot.downloads.active ||
    snapshot.downloads.pending.length > 0 ||
    pending ||
    !desktop;
  return (
    <div className="content-layout" data-ui-site="ContentPage-1">
      <Panel data-ui-site="ContentPage-2">
        <div className="settings-intro" data-ui-site="ContentPage-3">
          <h2 data-ui-site="ContentPage-4">{t('content.localTitle')}</h2>
          <p data-ui-site="ContentPage-5">{t('content.localDescription')}</p>
        </div>
        <Field label={t('content.instance')} data-ui-site="ContentPage-6">
          <Select
            value={profile?.instance_key ?? ''}
            onValueChange={(value) => actions.selectProfile(value || null)}
            options={[
              { value: '', label: t('content.chooseInstance') },
              ...config.profiles.map((profile) => ({
                value: profile.instance_key,
                label: `${profile.name} · ${profile.game_version} · ${profile.loader}`,
              })),
            ]}
            data-ui-site="ContentPage-7"
          />
        </Field>
        <div className="action-row" data-ui-site="ContentPage-8">
          {['mods', 'resourcepacks', 'shaderpacks', 'saves'].map((value) => (
            <button
              className={category === value ? 'primary small' : 'secondary small'}
              key={value}
              onClick={() => actions.setCategory(value as ContentCategory)}
              data-ui-site="ContentPage-9"
            >
              {t(`content.categories.${value}`)}
            </button>
          ))}
        </div>
        <div className="action-row content-toolbar" data-ui-site="ContentPage-10">
          <button
            className="secondary"
            disabled={!profile || !desktop || pending}
            onClick={() => {
              void actions.openDirectory();
            }}
            data-ui-site="ContentPage-11"
          >
            <FolderOpen size={16} data-ui-site="ContentPage-12" />
            {t('content.openFolder')}
          </button>
          <button
            className="secondary"
            disabled={!profile || pending}
            onClick={() => {
              void actions.refresh();
            }}
            data-ui-site="ContentPage-13"
          >
            <RefreshCw size={16} data-ui-site="ContentPage-14" />
            {t('content.refresh')}
          </button>
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => {
              void actions.importPack();
            }}
            data-ui-site="ContentPage-15"
          >
            <Upload size={16} data-ui-site="ContentPage-16" />
            {t('content.importPack')}
          </button>
          <button
            className="secondary"
            disabled={disabled || !profile}
            onClick={() => {
              void actions.exportInstance();
            }}
            data-ui-site="ContentPage-17"
          >
            {t('content.exportInstance')}
          </button>
        </div>
        <label className="checkbox-label" data-ui-site="ContentPage-18">
          <input
            type="checkbox"
            checked={includeSaves}
            onChange={(event) => actions.setIncludeSaves(event.target.checked)}
            data-ui-site="ContentPage-19"
          />
          {t('content.includeSaves')}
        </label>
        {!desktop && (
          <p className="help-text" data-ui-site="ContentPage-20">
            {t('api.desktopOnly')}
          </p>
        )}
        {profile && category === 'mods' && (
          <p className="help-text" data-ui-site="ContentPage-21">
            {t(profile.loader === 'vanilla' ? 'loaders.vanillaMods' : 'loaders.modCompatibility', {
              loader: profile.loader,
              version: profile.game_version,
            })}
          </p>
        )}
        <div className="content-list" data-ui-site="ContentPage-22">
          {entries.length === 0 ? (
            <p className="help-text" data-ui-site="ContentPage-23">
              {t('content.empty')}
            </p>
          ) : (
            entries.map((entry) => (
              <article className="content-entry" key={entry.name} data-ui-site="ContentPage-24">
                <div data-ui-site="ContentPage-25">
                  <strong data-ui-site="ContentPage-26">{entry.record?.title ?? entry.name}</strong>
                  <p className="help-text" data-ui-site="ContentPage-27">
                    {entry.name} · {(entry.size / 1024).toFixed(1)} KiB
                  </p>
                  <Badge muted data-ui-site="ContentPage-28">
                    {t(entry.enabled ? 'content.enabled' : 'content.disabled')}
                  </Badge>
                </div>
                <div className="action-row" data-ui-site="ContentPage-29">
                  {category === 'mods' && (
                    <button
                      className="secondary"
                      disabled={disabled}
                      onClick={() => {
                        void actions.toggleMod(entry.name);
                      }}
                      data-ui-site="ContentPage-30"
                    >
                      {t(entry.enabled ? 'content.disable' : 'content.enable')}
                    </button>
                  )}
                  {category !== 'saves' &&
                    (removing === entry.name ? (
                      <Fragment data-ui-site="ContentPage-31">
                        <button
                          className="danger"
                          disabled={disabled}
                          onClick={() => {
                            void actions.confirmRemove();
                          }}
                          data-ui-site="ContentPage-32"
                        >
                          {t('content.confirmRemove')}
                        </button>
                        <button
                          className="secondary"
                          disabled={pending}
                          onClick={actions.cancelRemove}
                          data-ui-site="ContentPage-33"
                        >
                          {t('common.cancel')}
                        </button>
                      </Fragment>
                    ) : (
                      <button
                        className="secondary"
                        disabled={disabled}
                        aria-label={t('content.remove')}
                        onClick={() => actions.beginRemove(entry.name)}
                        data-ui-site="ContentPage-34"
                      >
                        <Trash2 size={16} data-ui-site="ContentPage-35" />
                      </button>
                    ))}
                </div>
              </article>
            ))
          )}
        </div>
      </Panel>
      <Panel data-ui-site="ContentPage-36">
        <div className="settings-intro" data-ui-site="ContentPage-37">
          <h2 data-ui-site="ContentPage-38">Modrinth</h2>
          <p data-ui-site="ContentPage-39">{t('content.remoteDescription')}</p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void actions.search();
          }}
          data-ui-site="ContentPage-40"
        >
          <div className="field-grid" data-ui-site="ContentPage-41">
            <Field label={t('content.projectType')} data-ui-site="ContentPage-42">
              <Select
                value={kind}
                onValueChange={(kind) => actions.patchSearch({ kind: kind as ContentKind })}
                options={['mod', 'modpack', 'resourcepack', 'shader'].map((value) => ({
                  value,
                  label: t(`content.types.${value}`),
                }))}
                data-ui-site="ContentPage-43"
              />
            </Field>
            <Field label={t('content.search')} data-ui-site="ContentPage-44">
              <input
                value={query}
                maxLength={256}
                onChange={(event) => actions.patchSearch({ query: event.target.value })}
                data-ui-site="ContentPage-45"
              />
            </Field>
          </div>
          <button
            className="primary"
            disabled={!desktop || searching}
            type="submit"
            data-ui-site="ContentPage-46"
          >
            <Search size={16} data-ui-site="ContentPage-47" />
            {t('content.search')}
          </button>
        </form>
        {searching && (
          <p role="status" data-ui-site="ContentPage-48">
            {t('content.searching')}
          </p>
        )}
        <div className="content-list" data-ui-site="ContentPage-49">
          {results?.hits.map((project) => (
            <article
              className="content-entry"
              key={project.project_id}
              data-ui-site="ContentPage-50"
            >
              <div data-ui-site="ContentPage-51">
                <h3 data-ui-site="ContentPage-52">{project.title}</h3>
                <p data-ui-site="ContentPage-53">{project.description}</p>
                <small data-ui-site="ContentPage-54">
                  {t('content.downloadCount', { count: project.downloads })}
                </small>
              </div>
              <button
                className="secondary"
                disabled={
                  disabled ||
                  (project.project_type !== 'modpack' &&
                    (!profile || (project.project_type === 'mod' && profile.loader === 'vanilla')))
                }
                onClick={() => {
                  void actions.installProject(
                    project.project_id,
                    project.project_type as ContentKind,
                  );
                }}
                data-ui-site="ContentPage-55"
              >
                <Download size={16} data-ui-site="ContentPage-56" />
                {t(project.project_type === 'modpack' ? 'content.installPack' : 'content.install')}
              </button>
            </article>
          ))}
        </div>
        {results && request && (
          <div className="action-row" data-ui-site="ContentPage-57">
            <button
              className="secondary"
              disabled={searching || request.offset === 0}
              onClick={() => {
                void actions.search(Math.max(0, request.offset - 20));
              }}
              data-ui-site="ContentPage-58"
            >
              {t('content.previous')}
            </button>
            <span data-ui-site="ContentPage-59">
              {t('content.resultCount', { count: results.total_hits })}
            </span>
            <button
              className="secondary"
              disabled={
                searching || request.offset + 20 >= results.total_hits || request.offset >= 10000
              }
              onClick={() => {
                void actions.search(request.offset + 20);
              }}
              data-ui-site="ContentPage-60"
            >
              {t('content.next')}
            </button>
          </div>
        )}
        {!results && !searching && (
          <div className="empty-state" data-ui-site="ContentPage-61">
            <Package size={32} data-ui-site="ContentPage-62" />
            <p data-ui-site="ContentPage-63">{t('content.searchHelp')}</p>
          </div>
        )}
      </Panel>
    </div>
  );
}
export default ContentPage;
