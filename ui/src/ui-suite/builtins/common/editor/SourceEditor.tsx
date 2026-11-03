import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiEditorSnapshot, useUiEditorActions, useLauncherActions } from '@paradox/launcher';
import { TextArea, Button } from '@paradox/ui';
export default function SourceEditor() {
  const s = useUiEditorSnapshot(),
    a = useUiEditorActions(),
    path = s.selectedFile,
    file = path ? s.draft?.files[path] : null;
  const [wrap, setWrap] = useState(false);
  const { t } = useTranslation();
  const notifications = useLauncherActions().notifications;
  return (
    <section data-ui-site="SourceEditor-1" className="suite-source-editor">
      <h2 data-ui-site="SourceEditor-2">{path ?? 'Select a file'}</h2>
      {file?.encoding === 'utf8' ? (
        <Fragment data-ui-site="fragment-1">
          <TextArea
            data-ui-site="SourceEditor-3"
            className="ui-code"
            aria-label={t('uiSuiteEditor.source')}
            value={file.text}
            spellCheck={false}
            wrap={wrap ? 'soft' : 'off'}
            onChange={(e) => path && a.patchFile(path, e.currentTarget.value)}
          />
          <label data-ui-site="SourceEditor-wrap"><input data-ui-site="SourceEditor-wrap-input" type="checkbox" checked={wrap} onChange={(event) => setWrap(event.currentTarget.checked)} />{t('uiSuiteEditor.wrap')}</label>
          <label data-ui-site="SourceEditor-4">
            {t('uiSuiteEditor.importSource')}
            <input
              data-ui-site="SourceEditor-5"
              type="file"
              accept=".ts,.tsx,.css,.html"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) void a.importSource(f).then((loaded) => { if (loaded) notifications.publish('success', t('uiSuiteEditor.imported')); });
                e.currentTarget.value = '';
              }}
            />
          </label>
          <Button data-ui-site="SourceEditor-6" onClick={() => void a.exportSource()}>
            {t('uiSuiteEditor.exportSource')}
          </Button>
        </Fragment>
      ) : (
        <p data-ui-site="SourceEditor-7">Choose a text source file to edit.</p>
      )}
    </section>
  );
}
