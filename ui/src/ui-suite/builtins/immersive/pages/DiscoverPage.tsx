import { useTranslation } from 'react-i18next';
import { Download, Package, Plus, Search, Upload } from 'lucide-react';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import type { ContentKind } from '@paradox/launcher';
import { Badge, Field, Select, UiIdentity } from '@paradox/ui';
import '../styles/discover.css';
const kinds: ContentKind[] = ['mod', 'modpack', 'resourcepack', 'shader'];
export default function DiscoverPage() {
  const { t } = useTranslation(), s = useLauncherSnapshot(), a = useLauncherActions();
  const { query, kind, request, results, searchError, searching, pending, selectedProfileKey } = s.content;
  const profiles = s.config.value?.profiles ?? [];
  const profile = profiles.find(item => item.instance_key === selectedProfileKey);
  const desktop = s.window.desktop;
  const disabled = !desktop || !!s.activity || s.settings.saving || s.downloads.active || s.downloads.pending.length > 0 || pending;
  const searchUnchanged = request?.query === query && request?.kind === kind;
  const target = <section
    className="discover-target"
    data-ui-site="Discover-target">
    <div
      className="discover-target-label"
      data-ui-site="Discover-target-label">
      <Download
      size={18}
      data-ui-site="Discover-target-icon"/>
      <h2
        data-ui-site="Discover-target-title">{t('accountDiscovery.installTarget')}
      </h2>
    </div>
    <Field
      label={t('content.instance')}
      description={t('accountDiscovery.targetDescription')}
      data-ui-site="Discover-target-field">
      <Select
      value={profile?.instance_key ?? ''}
      onValueChange={value => a.content.selectProfile(value || null)}
      options={[{ value: '', label: t('content.chooseInstance') }, ...profiles.map(item => ({ value: item.instance_key, label: `${item.name} · ${item.game_version} · ${item.loader}` }))]}
      data-ui-site="Discover-target-select"/>
    </Field>
    {profile ? <p
      className="discover-target-summary"
      data-ui-site="Discover-target-summary">{profile.name} · Minecraft {profile.game_version} · {profile.loader}
    </p> : <p
      className="discover-guidance"
      data-ui-site="Discover-no-target">{t(profiles.length ? 'accountDiscovery.selectTarget' : 'accountDiscovery.noInstances')}
    </p>}
    {!profiles.length && <button
      className="secondary"
      disabled={disabled}
      onClick={() => a.profileDraft.openCreate()}
      data-ui-site="Discover-create">
      <Plus
      size={16}
      data-ui-site="Discover-create-icon"/>{t('app.createInstance')}
    </button>}
    {profile?.loader === 'vanilla' && <p
      className="discover-guidance"
      data-ui-site="Discover-vanilla">{t('loaders.vanillaMods')}
    </p>}

    <p
      className="discover-pack-help"
      data-ui-site="Discover-pack-help">{t('accountDiscovery.packCreatesInstance')}
    </p>

  </section>;
  const search = <section
    className="discover-search"
    data-ui-site="Discover-search">
    <header
      className="discover-intro"
      data-ui-site="Discover-intro">
      <div
        data-ui-site="Discover-title-group">
        <p
          className="discover-eyebrow"
          data-ui-site="Discover-eyebrow">{t('accountDiscovery.resourceLibrary')}
        </p>
        <h2
          data-ui-site="Discover-title">Modrinth</h2>
      </div>
      <button
        className="secondary"
        disabled={disabled}
        onClick={() => void a.content.importPack()}
        data-ui-site="Discover-import">
        <Upload
        size={16}
        data-ui-site="Discover-import-icon"/>{t('content.importPack')}
      </button>
    </header>
    <p
      className="discover-description"
      data-ui-site="Discover-description">{t('accountDiscovery.searchScope')}
    </p>

    <form
      onSubmit={event => { event.preventDefault(); void a.content.search(); }}
      data-ui-site="Discover-form">
      <div
        className="discover-kinds"
        role="group"
        aria-label={t('content.projectType')}
        data-ui-site="Discover-kinds">{kinds.map(value =>
        <button
          type="button"
          key={value}
          className={kind === value ? 'primary' : 'secondary'}
          aria-pressed={kind === value}
          onClick={() => a.content.patchSearch({ kind: value })}
          data-content-kind={value}
          data-ui-site="Discover-kind">{t(`content.types.${value}`)}
        </button>)}
      </div>
      <div
        className="discover-query-row"
        data-ui-site="Discover-query-row">
        <Field
          label={t('content.search')}
          data-ui-site="Discover-query-field">
          <input
          value={query}
          maxLength={256}
          onChange={event => a.content.patchSearch({ query: event.target.value })}
          placeholder={t('accountDiscovery.searchPlaceholder')}
          data-ui-site="Discover-query"/>
        </Field>
        <button
          className="primary"
          type="submit"
          disabled={!desktop || (searching && searchUnchanged)}
          data-ui-site="Discover-submit">
          <Search
          size={17}
          data-ui-site="Discover-search-icon"/>{t('content.search')}
        </button>
      </div>
    </form>
    {!desktop && <p
      className="discover-guidance"
      data-ui-site="Discover-desktop-only">{t('api.desktopOnly')}
    </p>}

  </section>;
  const matches = <section
    className="discover-results"
    aria-busy={searching}
    data-ui-site="Discover-results">
    {request && <header
      className="discover-result-heading"
      data-ui-site="Discover-result-heading">
      <h2
        data-ui-site="Discover-request-title">{t('accountDiscovery.requestTitle', { query: request.query || t('accountDiscovery.allProjects'), kind: t(`content.types.${request.kind}`) })}
      </h2>
      <span
        data-ui-site="Discover-request-page">{t('accountDiscovery.page', { page: Math.floor(request.offset / 20) + 1 })}
      </span>
    </header>}
    {searching && <p
      role="status"
      data-ui-site="Discover-searching">{t('content.searching')}
    </p>}
    {searchError !== null && request && <div
      className="discover-error"
      role="alert"
      data-ui-site="Discover-error">
      <h3
        data-ui-site="Discover-error-title">{t('accountDiscovery.searchFailed')}
      </h3>
      <p
        data-ui-site="Discover-error-detail">{searchError}
      </p>
      <button
        className="secondary"
        disabled={!desktop || searching}
        onClick={() => void a.content.search(request.offset)}
        data-ui-site="Discover-retry">{t('accountDiscovery.retryRequest')}
      </button>
    </div>}
    {!request && !searching && <div
      className="discover-empty"
      data-ui-site="Discover-initial">
      <Package
      size={32}
      data-ui-site="Discover-initial-icon"/>
      <h3
        data-ui-site="Discover-initial-title">{t('accountDiscovery.startSearch')}
      </h3>
      <p
        data-ui-site="Discover-initial-help">{t('content.searchHelp')}
      </p>
    </div>}
    {results && !results.hits.length && !searching && <div
      className="discover-empty"
      data-ui-site="Discover-empty">
      <Search
      size={30}
      data-ui-site="Discover-empty-icon"/>
      <h3
        data-ui-site="Discover-empty-title">{t('accountDiscovery.noResults')}
      </h3>
      <p
        data-ui-site="Discover-empty-help">{t('accountDiscovery.noResultsHelp')}
      </p>
    </div>}

    <div
      className="discover-result-list"
      data-ui-site="Discover-result-list">{results?.hits.map(project =>
      <UiIdentity
        key={project.project_id}
        namespace="project"
        value={project.project_id}>
        <article
          className="discover-result"
          data-project-id={project.project_id}
          data-ui-site="Discover-result">
          <div
            className="discover-project-symbol"
            aria-hidden="true"
            data-ui-site="Discover-project-symbol">
            <Package
            size={25}
            data-ui-site="Discover-project-icon"/>
          </div>
          <div
            className="discover-project-copy"
            data-ui-site="Discover-project-copy">
            <div
              className="discover-project-heading"
              data-ui-site="Discover-project-heading">
              <h3
                data-ui-site="Discover-project-title">{project.title}
              </h3>
              <Badge
                muted
                data-ui-site="Discover-project-kind">{t(`content.types.${project.project_type}`)}
              </Badge>
            </div>
            <p
              data-ui-site="Discover-project-description">{project.description}
            </p>
            <small
              data-ui-site="Discover-project-downloads">{t('content.downloadCount', { count: project.downloads })}
            </small>
          </div>
          <button
            className="secondary"
            disabled={disabled || (project.project_type !== 'modpack' && (!profile || (project.project_type === 'mod' && profile.loader === 'vanilla')))}
            onClick={() => void a.content.installProject(project.project_id, project.project_type as ContentKind)}
            data-ui-site="Discover-install">
            <Download
            size={16}
            data-ui-site="Discover-install-icon"/>{t(project.project_type === 'modpack' ? 'content.installPack' : 'content.install')}
          </button>
        </article>
      </UiIdentity>)}
    </div>
    {results && request && <nav
      className="discover-pagination"
      aria-label={t('accountDiscovery.pagination')}
      data-ui-site="Discover-pagination">
      <button
        className="secondary"
        disabled={!desktop || searching || request.offset === 0}
        onClick={() => void a.content.search(Math.max(0, request.offset - 20))}
        data-ui-site="Discover-previous">{t('content.previous')}
      </button>
      <span
        data-ui-site="Discover-result-count">{t('content.resultCount', { count: results.total_hits })}
      </span>
      <button
        className="secondary"
        disabled={!desktop || searching || request.offset + 20 >= results.total_hits || request.offset >= 10000}
        onClick={() => void a.content.search(request.offset + 20)}
        data-ui-site="Discover-next">{t('content.next')}
      </button>
    </nav>}

  </section>;
  return <div
    className="discover-page immersive-discover"
    data-ui-site="Discover-page">{search}
    <div
      className="discover-workspace"
      data-ui-site="Discover-workspace">
      <aside
        className="discover-sidebar"
        data-ui-site="Discover-sidebar">{target}
      </aside>{matches}
    </div>
  </div>;
}
