import { customComponent } from '../customization/Customizable';
import { useTranslation } from 'react-i18next';
import { Download, FolderOpen, Package, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import type { ContentCategory, ContentKind } from '@paradox/launcher';
import { Badge, Field, Panel, Select } from '../components/ui';

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
    <div className="content-layout">
      <Panel>
        <div className="settings-intro">
          <h2>{t('content.localTitle')}</h2>
          <p>{t('content.localDescription')}</p>
        </div>
        <Field label={t('content.instance')}>
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
          />
        </Field>
        <div className="action-row">
          {['mods', 'resourcepacks', 'shaderpacks', 'saves'].map((value) => (
            <button
              className={category === value ? 'primary small' : 'secondary small'}
              key={value}
              onClick={() => actions.setCategory(value as ContentCategory)}
            >
              {t(`content.categories.${value}`)}
            </button>
          ))}
        </div>
        <div className="action-row content-toolbar">
          <button
            className="secondary"
            disabled={!profile || !desktop || pending}
            onClick={() => {
              void actions.openDirectory();
            }}
          >
            <FolderOpen size={16} />
            {t('content.openFolder')}
          </button>
          <button
            className="secondary"
            disabled={!profile || pending}
            onClick={() => {
              void actions.refresh();
            }}
          >
            <RefreshCw size={16} />
            {t('content.refresh')}
          </button>
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => {
              void actions.importPack();
            }}
          >
            <Upload size={16} />
            {t('content.importPack')}
          </button>
          <button
            className="secondary"
            disabled={disabled || !profile}
            onClick={() => {
              void actions.exportInstance();
            }}
          >
            {t('content.exportInstance')}
          </button>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={includeSaves}
            onChange={(event) => actions.setIncludeSaves(event.target.checked)}
          />
          {t('content.includeSaves')}
        </label>
        {!desktop && <p className="help-text">{t('api.desktopOnly')}</p>}
        {profile && category === 'mods' && (
          <p className="help-text">
            {t(profile.loader === 'vanilla' ? 'loaders.vanillaMods' : 'loaders.modCompatibility', {
              loader: profile.loader,
              version: profile.game_version,
            })}
          </p>
        )}
        <div className="content-list">
          {entries.length === 0 ? (
            <p className="help-text">{t('content.empty')}</p>
          ) : (
            entries.map((entry) => (
              <article className="content-entry" key={entry.name}>
                <div>
                  <strong>{entry.record?.title ?? entry.name}</strong>
                  <p className="help-text">
                    {entry.name} · {(entry.size / 1024).toFixed(1)} KiB
                  </p>
                  <Badge muted>{t(entry.enabled ? 'content.enabled' : 'content.disabled')}</Badge>
                </div>
                <div className="action-row">
                  {category === 'mods' && (
                    <button
                      className="secondary"
                      disabled={disabled}
                      onClick={() => {
                        void actions.toggleMod(entry.name);
                      }}
                    >
                      {t(entry.enabled ? 'content.disable' : 'content.enable')}
                    </button>
                  )}
                  {category !== 'saves' &&
                    (removing === entry.name ? (
                      <>
                        <button
                          className="danger"
                          disabled={disabled}
                          onClick={() => {
                            void actions.confirmRemove();
                          }}
                        >
                          {t('content.confirmRemove')}
                        </button>
                        <button
                          className="secondary"
                          disabled={pending}
                          onClick={actions.cancelRemove}
                        >
                          {t('common.cancel')}
                        </button>
                      </>
                    ) : (
                      <button
                        className="secondary"
                        disabled={disabled}
                        aria-label={t('content.remove')}
                        onClick={() => actions.beginRemove(entry.name)}
                      >
                        <Trash2 size={16} />
                      </button>
                    ))}
                </div>
              </article>
            ))
          )}
        </div>
      </Panel>
      <Panel>
        <div className="settings-intro">
          <h2>Modrinth</h2>
          <p>{t('content.remoteDescription')}</p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void actions.search();
          }}
        >
          <div className="field-grid">
            <Field label={t('content.projectType')}>
              <Select
                value={kind}
                onValueChange={(kind) => actions.patchSearch({ kind: kind as ContentKind })}
                options={['mod', 'modpack', 'resourcepack', 'shader'].map((value) => ({
                  value,
                  label: t(`content.types.${value}`),
                }))}
              />
            </Field>
            <Field label={t('content.search')}>
              <input
                value={query}
                maxLength={256}
                onChange={(event) => actions.patchSearch({ query: event.target.value })}
              />
            </Field>
          </div>
          <button className="primary" disabled={!desktop || searching} type="submit">
            <Search size={16} />
            {t('content.search')}
          </button>
        </form>
        {searching && <p role="status">{t('content.searching')}</p>}
        <div className="content-list">
          {results?.hits.map((project) => (
            <article className="content-entry" key={project.project_id}>
              <div>
                <h3>{project.title}</h3>
                <p>{project.description}</p>
                <small>{t('content.downloadCount', { count: project.downloads })}</small>
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
              >
                <Download size={16} />
                {t(project.project_type === 'modpack' ? 'content.installPack' : 'content.install')}
              </button>
            </article>
          ))}
        </div>
        {results && request && (
          <div className="action-row">
            <button
              className="secondary"
              disabled={searching || request.offset === 0}
              onClick={() => {
                void actions.search(Math.max(0, request.offset - 20));
              }}
            >
              {t('content.previous')}
            </button>
            <span>{t('content.resultCount', { count: results.total_hits })}</span>
            <button
              className="secondary"
              disabled={
                searching || request.offset + 20 >= results.total_hits || request.offset >= 10000
              }
              onClick={() => {
                void actions.search(request.offset + 20);
              }}
            >
              {t('content.next')}
            </button>
          </div>
        )}
        {!results && !searching && (
          <div className="empty-state">
            <Package size={32} />
            <p>{t('content.searchHelp')}</p>
          </div>
        )}
      </Panel>
    </div>
  );
}

const CustomizedContentPage = customComponent('page.content', ContentPage);
export default CustomizedContentPage;
