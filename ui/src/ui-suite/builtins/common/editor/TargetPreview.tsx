import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiEditorActions } from '@paradox/launcher';
import type { DomPreviewHandle, DomPreviewSnapshot, UiSelector, UiTargetDescriptor } from '@paradox/launcher';
import { Button } from '@paradox/ui';

const empty: DomPreviewSnapshot = Object.freeze({ status: 'unmounted', reason: null, rootCount: 0, locations: Object.freeze([]) });
const noSubscribe = () => () => {};
const emptySnapshot = () => empty;
export default function TargetPreview({ target }: { target: UiTargetDescriptor }) {
  const a = useUiEditorActions(), { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null), [handle, setHandle] = useState<DomPreviewHandle | null>(null);
  const key = JSON.stringify(target.selector, ['kind','target','locator','version','renderRoot','calls','site','key','business','identity','namespace','value']);
  useEffect(() => {
    if (!container.current) return;
    const current = a.createDomPreview(JSON.parse(key) as UiSelector, container.current); setHandle(current);
    return () => current.dispose();
  }, [a, key]);
  const state = useSyncExternalStore(handle?.subscribe ?? noSubscribe, handle?.getSnapshot ?? emptySnapshot, emptySnapshot);
  return <section data-ui-site="TargetPreview-root" className="ui-target-preview" aria-label={t('uiInspector.preview.title')}>
    <h3 data-ui-site="TargetPreview-title">{t('uiInspector.preview.title')}</h3>
    <p data-ui-site="TargetPreview-current">{t('uiInspector.preview.current')}</p>
    <div data-ui-site="TargetPreview-container" className="ui-target-preview-image" ref={container} />
    {state.status !== 'resolved' && <p data-ui-site="TargetPreview-status" role="status">{t(`uiInspector.preview.${state.status}`)}</p>}
    {state.reason && <p data-ui-site="TargetPreview-reason" role="status">{state.reason}</p>}
    <Button data-ui-site="TargetPreview-locate" disabled={state.status !== 'resolved' || state.locations.filter(location => location.rootCount).length !== 1} onClick={() => void a.locateTarget(target.selector)}>{t('uiInspector.preview.locate')}</Button>
    {state.locations.length > 1 && <div data-ui-site="TargetPreview-locations" className="ui-target-preview-locations">
      <p data-ui-site="TargetPreview-choose">{t('uiInspector.preview.choosePosition')}</p>
      {state.locations.map((location) => <Button data-ui-site="TargetPreview-position" key={JSON.stringify(location.selector)} disabled={!location.rootCount} onClick={() => void a.locateTarget(location.selector)}>{t('uiInspector.preview.position', { index: location.index + 1 })}</Button>)}
    </div>}
  </section>;
}
