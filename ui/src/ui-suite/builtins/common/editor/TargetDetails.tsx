import { useTranslation } from 'react-i18next';
import { useLauncherActions, useLauncherSnapshot, useUiEditorActions, useUiEditorSnapshot } from '@paradox/launcher';
import { Button, Select } from '@paradox/ui';
import type { UiEditorSourceKind } from '@paradox/launcher';
import TargetPreview from './TargetPreview';

export default function TargetDetails() {
  const s = useUiEditorSnapshot(), a = useUiEditorActions(), launcher = useLauncherActions(), routes = useLauncherSnapshot().navigation.routes;
  const { t } = useTranslation(), target = s.currentTarget;
  if (!target) return <p data-ui-site="TargetDetails-empty">{t('uiInspector.chooseTarget')}</p>;
  const selectorKey = (selector: typeof s.targets[number]['selector']) => JSON.stringify(selector, ['kind', 'target', 'locator', 'version', 'renderRoot', 'calls', 'site', 'key', 'business', 'identity', 'namespace', 'value']);
  const selected = s.selection && selectorKey(s.selection.selector);
  return <section data-ui-site="TargetDetails-root" className="ui-target-details" aria-label={t('uiInspector.details')}>
    <h2 data-ui-site="TargetDetails-name">{target.name}</h2>
    <code data-ui-site="TargetDetails-id">{target.selector.target}</code>
    <nav data-ui-site="TargetDetails-ancestors" data-ui-inspector-controls={s.picking ? '' : undefined} aria-label={t('uiInspector.ancestors')}>
      {s.targetAncestors.map((ancestor) => <Button data-ui-site="TargetDetails-parent" key={selectorKey(ancestor.selector)} onClick={() => a.selectTarget(ancestor.selector)}>{ancestor.name} · {ancestor.selector.target}</Button>)}
    </nav>
    <dl data-ui-site="TargetDetails-values">
      <dt data-ui-site="TargetDetails-type-label">{t('uiInspector.type')}</dt><dd data-ui-site="TargetDetails-type">{target.type}</dd>
      <dt data-ui-site="TargetDetails-source-label">{t('uiInspector.source')}</dt><dd data-ui-site="TargetDetails-source">{target.sourcePath ?? t('uiInspector.noSource')}</dd>
      <dt data-ui-site="TargetDetails-binding-label">{t('uiInspector.binding')}</dt><dd data-ui-site="TargetDetails-binding">{s.selection?.filePath ?? t('uiInspector.noBinding')}</dd>
      <dt data-ui-site="TargetDetails-route-label">{t('uiInspector.route')}</dt><dd data-ui-site="TargetDetails-route">{target.routeId ?? t('uiInspector.noRoute')}</dd>
      <dt data-ui-site="TargetDetails-status-label">{t('uiInspector.status')}</dt><dd data-ui-site="TargetDetails-status">{t(`uiInspector.states.${target.status}`)} · {t(`uiInspector.visibility.${target.visibility}`)}</dd>
      <dt data-ui-site="TargetDetails-count-label">{t('uiInspector.scope')}</dt><dd data-ui-site="TargetDetails-count">{t(`uiInspector.scopes.${target.selector.kind}`)} · {t('uiInspector.matches', { count: target.matchCount })}</dd>
      <dt data-ui-site="TargetDetails-stability-label">{t('uiInspector.stability')}</dt><dd data-ui-site="TargetDetails-stability">{target.stability}</dd>
    </dl>
    {target.reason && <p data-ui-site="TargetDetails-reason" role="status">{target.reason}</p>}
    {!!s.scopeChoices.length && <span data-ui-site="TargetDetails-scope-controls" data-ui-inspector-controls={s.picking ? '' : undefined}>{s.picking ? s.scopeChoices.map(choice => <Button data-ui-site="TargetDetails-pick-scope" key={selectorKey(choice.selector)} aria-pressed={selectorKey(choice.selector) === selected} onClick={() => a.selectTarget(choice.selector)}>{t(`uiInspector.scopes.${choice.selector.kind}`)} · {choice.name} · {t('uiInspector.matches', { count: choice.matchCount })}</Button>) : <Select data-ui-site="TargetDetails-scope" aria-label={t('uiSuiteEditor.scope')} value={s.scopeChoices.some((choice) => selectorKey(choice.selector) === selected) ? selected! : ''} options={s.scopeChoices.map((choice) => ({ value: selectorKey(choice.selector), label: `${t(`uiInspector.scopes.${choice.selector.kind}`)} · ${choice.name} · ${t('uiInspector.matches', { count: choice.matchCount })}` }))} onValueChange={(value) => { const choice = s.scopeChoices.find((item) => selectorKey(item.selector) === value); if (choice) a.selectTarget(choice.selector); }} />}</span>}
    {!s.picking && <>{target.routeId && routes.some((route) => route.id === target.routeId) && <Button data-ui-site="TargetDetails-navigate" onClick={() => target.routeId && launcher.navigation.navigate(target.routeId)}>{t('uiInspector.goToRoute')}</Button>}
    <div data-ui-site="TargetDetails-source-controls" className="ui-target-source-controls">
      {(['css', 'html', 'tsx'] as UiEditorSourceKind[]).map(kind => <Button data-ui-site="TargetDetails-source-tab" key={kind} aria-pressed={s.selection?.sourceKind === kind} onClick={() => a.setSourceKind(kind)}>{kind.toUpperCase()}</Button>)}
      <Button data-ui-site="TargetDetails-create-override" disabled={!!s.pending} onClick={() => void a.createSelectionOverride(s.selection?.sourceKind ?? 'css')}>{t('uiInspector.createOverride', { kind: s.selection?.sourceKind.toUpperCase() ?? 'CSS' })}</Button>
      <Button data-ui-site="TargetDetails-reset" disabled={!s.draft?.manifest.overrides.some(item => selectorKey(item.selector) === selected)} onClick={() => a.resetSelectionOverride()}>{t('uiSuiteEditor.resetOverride')}</Button>
      <p data-ui-site="TargetDetails-retain-files">{t('uiInspector.resetKeepsFiles')}</p>
    </div>
    <TargetPreview data-ui-site="TargetDetails-preview" target={target} /></>}
  </section>;
}
