import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLauncherSnapshot, useUiEditorActions, useUiEditorSnapshot } from '@paradox/launcher';
import { Button, Input, Select, UiCatalogPresentation } from '@paradox/ui';

export default function TargetCatalog() {
  const s = useUiEditorSnapshot(), a = useUiEditorActions(), navigation = useLauncherSnapshot().navigation;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false), [search, setSearch] = useState(''), [group, setGroup] = useState('all'), [limit, setLimit] = useState(40), [manual, setManual] = useState('');
  const groupOf = (target: typeof s.targets[number]) => target.selector.target.startsWith('page.') || target.selector.target.startsWith('dialog.') ? 'route' : target.selector.target.startsWith('tool.') || target.selector.target.startsWith('layout.') ? 'suite' : target.type === 'control' ? 'control' : target.type === 'element' ? 'element' : 'component';
  const filtered = s.targets.filter((target) => (group === 'all' || groupOf(target) === group) && [target.name, target.selector.target, target.routeId, target.sourcePath, navigation.routes.find((route) => route.id === target.routeId)?.title].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const selectorKey = (selector: typeof s.targets[number]['selector']) => JSON.stringify(selector, ['kind', 'target', 'locator', 'version', 'renderRoot', 'calls', 'site', 'key', 'business', 'identity', 'namespace', 'value']);
  const selected = s.selection && selectorKey(s.selection.selector);
  return <section data-ui-site="TargetCatalog-root" className="ui-target-catalog" aria-label={t('uiInspector.catalog')}>
    <Button data-ui-site="TargetCatalog-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{t('uiInspector.catalog')} ({s.targets.length})</Button>
    {open && <div data-ui-site="TargetCatalog-body">
      <p data-ui-site="TargetCatalog-suite">{s.suites.find((suite) => suite.id === s.selectedSuiteId)?.name}</p>
      <Input data-ui-site="TargetCatalog-search" aria-label={t('uiInspector.search')} placeholder={t('uiInspector.search')} value={search} onChange={(event) => { setSearch(event.currentTarget.value); setLimit(40); }} />
      <Select data-ui-site="TargetCatalog-group" aria-label={t('uiInspector.group')} value={group} options={['all', 'suite', 'route', 'component', 'control', 'element'].map((value) => ({ value, label: t(`uiInspector.groups.${value}`) }))} onValueChange={(value) => { setGroup(value); setLimit(40); }} />
      <p data-ui-site="TargetCatalog-results" role="status">{t('uiInspector.results', { count: filtered.length })}</p>
      <UiCatalogPresentation data-ui-site="TargetCatalog-presentation">
        <ul data-ui-site="TargetCatalog-list" className="ui-target-list">
          {filtered.slice(0, limit).map((target) => <li data-ui-site="TargetCatalog-row" key={selectorKey(target.selector)}>
            <Button data-ui-site="TargetCatalog-select" aria-pressed={selected === selectorKey(target.selector)} onClick={() => a.selectTarget(target.selector)}>
              <strong data-ui-site="TargetCatalog-name">{target.name}</strong>
              <code data-ui-site="TargetCatalog-id">{target.selector.target}</code>
              <span data-ui-site="TargetCatalog-info">{t(`uiInspector.scopes.${target.selector.kind}`)} · {t(`uiInspector.states.${target.status}`)} · {t('uiInspector.matches', { count: target.matchCount })}</span>
              <span data-ui-site="TargetCatalog-origin">{t(`uiInspector.groups.${groupOf(target)}`)} · {target.routeId ?? t('uiInspector.noRoute')} · {target.sourcePath ?? t('uiInspector.noSource')}</span>
            </Button>
          </li>)}
        </ul>
      </UiCatalogPresentation>
      {filtered.length > limit && <Button data-ui-site="TargetCatalog-more" onClick={() => setLimit((value) => value + 40)}>{t('uiInspector.more')}</Button>}
      <Input data-ui-site="TargetCatalog-manual" aria-label={t('uiInspector.manualId')} value={manual} onChange={(event) => setManual(event.currentTarget.value)} />
      <Button data-ui-site="TargetCatalog-manual-select" disabled={!manual.trim()} onClick={() => a.selectTarget({ kind: 'type', target: manual.trim() })}>{t('uiInspector.selectManual')}</Button>
    </div>}
  </section>;
}
