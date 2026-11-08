import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { Field, Input, TextArea, UiIdentity } from '@paradox/ui';
import type { DeepReadonly, EnvironmentRow } from '@paradox/launcher';
import { viewProps } from '../../common/lib/view';
import '../styles/business-dialogs.css';
export interface Props { rows: DeepReadonly<EnvironmentRow[]>; disabled: boolean; onChange: (rows: EnvironmentRow[]) => void; }
export default function EnvironmentEditor(input: Props | { props?: Readonly<Record<string, unknown>> }) {
  const { rows, disabled, onChange } = viewProps<Props>(input), { t } = useTranslation();
  return <div className="modern-environment-editor" data-ui-site="ModernEnvironmentEditor-list">
    {rows.map((row, index) => <UiIdentity key={index} namespace="environment-row" value={String(index)}>
      <div className="environment-row" data-ui-site="ModernEnvironmentEditor-row">
        <Field label={t('argumentTemplates.variableName', { index: index + 1 })} data-ui-site="ModernEnvironmentEditor-key-field">
          <Input maxLength={128} disabled={disabled} autoCapitalize="off" spellCheck={false} value={row.key}
            onChange={event => onChange(rows.map((value, current) => current === index ? { ...value, key: event.target.value } : { ...value }))}
            data-ui-site="ModernEnvironmentEditor-key"/>
        </Field>
        <Field label={t('argumentTemplates.variableValue', { index: index + 1 })} data-ui-site="ModernEnvironmentEditor-value-field">
          <TextArea rows={2} disabled={disabled} spellCheck={false} value={row.value}
            onChange={event => onChange(rows.map((value, current) => current === index ? { ...value, value: event.target.value } : { ...value }))}
            data-ui-site="ModernEnvironmentEditor-value"/>
        </Field>
        <button type="button" className="secondary small environment-remove" disabled={disabled} aria-label={t('argumentTemplates.removeVariable', { index: index + 1 })}
          onClick={() => onChange(rows.filter((_, current) => current !== index).map(value => ({ ...value })))} data-ui-site="ModernEnvironmentEditor-remove">
          <Trash2 size={15} aria-hidden="true" data-ui-site="ModernEnvironmentEditor-remove-icon"/>{t('common.remove')}
        </button>
      </div>
    </UiIdentity>)}
    <button type="button" className="secondary small" disabled={disabled || rows.length >= 64} onClick={() => onChange([...rows.map(row => ({ ...row })), { key: '', value: '' }])} data-ui-site="ModernEnvironmentEditor-add">
      <Plus size={15} aria-hidden="true" data-ui-site="ModernEnvironmentEditor-add-icon"/>{t('argumentTemplates.addVariable')}
    </button>
  </div>;
}
