import { useTranslation } from 'react-i18next';
import { useUiEditorSnapshot, useUiEditorActions } from '@paradox/launcher';
import { Button, UiCatalogPresentation } from '@paradox/ui';
export default function FileTree() {
  const s = useUiEditorSnapshot(),
    a = useUiEditorActions();
  const { t } = useTranslation();
  return (
    <UiCatalogPresentation data-ui-site="FileTree-1">
      <nav data-ui-site="FileTree-2" className="suite-file-tree" aria-label={t('uiSuiteEditor.files')}>
        {s.files.map((f) => (
          <Button
            data-ui-site="FileTree-3"
            key={f.path}
            className={s.selectedFile === f.path ? 'selected' : ''}
            onClick={() => a.selectFile(f.path)}
            aria-pressed={s.selectedFile === f.path}
          >
            {f.path}
            <small data-ui-site="FileTree-4">
              {f.kind} · {f.bytes} B
            </small>
          </Button>
        ))}
      </nav>
    </UiCatalogPresentation>
  );
}
