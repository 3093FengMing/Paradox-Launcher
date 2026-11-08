import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { Field, Input, TextArea, UiIdentity } from '@paradox/ui';
import type { DeepReadonly, EnvironmentRow } from '@paradox/launcher';
import { viewProps } from '../../common/lib/view';
import '../styles/business-dialogs.css';
export interface Props { rows: DeepReadonly<EnvironmentRow[]>; disabled: boolean; onChange: (rows: EnvironmentRow[]) => void; }
export default function EnvironmentEditor(input: Props | { props?: Readonly<Record<string, unknown>> }) {
  const p = viewProps<Props>(input), { t } = useTranslation();
  return <div className="immersive-environment-editor" data-ui-site="ImmersiveEnvironmentEditor-list">
    {p.rows.map((row, index) => <UiIdentity namespace="environment-row" value={String(index)} key={index}>
      <section className="environment-row" data-ui-site="ImmersiveEnvironmentEditor-row">
        <div className="environment-row-key" data-ui-site="ImmersiveEnvironmentEditor-key-panel">
          <Field label={t('argumentTemplates.variableName', { index: index + 1 })} data-ui-site="ImmersiveEnvironmentEditor-key-field">
            <Input value={row.key} disabled={p.disabled} maxLength={128} autoCapitalize="off" spellCheck={false}
              onChange={event => p.onChange(p.rows.map((item, current) => ({ ...item, ...(current === index ? { key: event.target.value } : {}) })))}
              data-ui-site="ImmersiveEnvironmentEditor-key"/>
          </Field>
          <button type="button" className="secondary small" disabled={p.disabled} aria-label={t('argumentTemplates.removeVariable', { index: index + 1 })} onClick={() => p.onChange(p.rows.filter((_, current) => current !== index).map(item => ({ ...item })))} data-ui-site="ImmersiveEnvironmentEditor-remove">
            <Trash2 size={15} aria-hidden="true" data-ui-site="ImmersiveEnvironmentEditor-remove-icon"/>{t('common.remove')}
          </button>
        </div>
        <Field label={t('argumentTemplates.variableValue', { index: index + 1 })} data-ui-site="ImmersiveEnvironmentEditor-value-field">
          <TextArea value={row.value} rows={2} spellCheck={false} disabled={p.disabled} onChange={event => p.onChange(p.rows.map((item, current) => ({ ...item, ...(current === index ? { value: event.target.value } : {}) })))} data-ui-site="ImmersiveEnvironmentEditor-value"/>
        </Field>
      </section>
    </UiIdentity>)}
    <button type="button" className="secondary small" disabled={p.disabled || p.rows.length >= 64} onClick={() => p.onChange([...p.rows.map(item => ({ ...item })), { key: '', value: '' }])} data-ui-site="ImmersiveEnvironmentEditor-add"><Plus size={15} aria-hidden="true" data-ui-site="ImmersiveEnvironmentEditor-add-icon"/>{t('argumentTemplates.addVariable')}</button>
  </div>;
}
