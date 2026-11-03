import { useTranslation } from 'react-i18next';
import type { EnvironmentRow, DeepReadonly } from '@paradox/launcher';
import { Plus, Trash2 } from 'lucide-react';
import { Field } from '@paradox/ui';
interface EnvironmentEditorProps {
  rows: DeepReadonly<EnvironmentRow[]>;
  disabled: boolean;
  onChange: (rows: EnvironmentRow[]) => void;
}
function EnvironmentEditor({ rows, disabled, onChange }: EnvironmentEditorProps) {
  const { t } = useTranslation();
  return (
    <div data-ui-site="EnvironmentEditor-1">
      {rows.map((row, index) => (
        <div className="field-grid" key={index} data-ui-site="EnvironmentEditor-2">
          <Field
            label={t('argumentTemplates.variableName', { index: index + 1 })}
            data-ui-site="EnvironmentEditor-3"
          >
            <input
              value={row.key}
              maxLength={128}
              disabled={disabled}
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) =>
                onChange(
                  rows.map((value, current) =>
                    current === index ? { ...value, key: event.target.value } : value,
                  ),
                )
              }
              data-ui-site="EnvironmentEditor-4"
            />
          </Field>
          <Field
            label={t('argumentTemplates.variableValue', { index: index + 1 })}
            data-ui-site="EnvironmentEditor-5"
          >
            <textarea
              value={row.value}
              rows={2}
              disabled={disabled}
              spellCheck={false}
              onChange={(event) =>
                onChange(
                  rows.map((value, current) =>
                    current === index ? { ...value, value: event.target.value } : value,
                  ),
                )
              }
              data-ui-site="EnvironmentEditor-6"
            />
          </Field>
          <button
            type="button"
            className="secondary small"
            disabled={disabled}
            aria-label={t('argumentTemplates.removeVariable', { index: index + 1 })}
            onClick={() => onChange(rows.filter((_, current) => current !== index))}
            data-ui-site="EnvironmentEditor-7"
          >
            <Trash2 size={15} data-ui-site="EnvironmentEditor-8" /> {t('common.remove')}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary small"
        disabled={disabled || rows.length >= 64}
        onClick={() => onChange([...rows, { key: '', value: '' }])}
        data-ui-site="EnvironmentEditor-9"
      >
        <Plus size={15} data-ui-site="EnvironmentEditor-10" /> {t('argumentTemplates.addVariable')}
      </button>
    </div>
  );
}
export default EnvironmentEditor;
