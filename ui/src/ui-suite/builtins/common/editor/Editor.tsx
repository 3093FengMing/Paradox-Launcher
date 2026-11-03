import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiEditorSnapshot, useUiEditorActions, useLauncherActions } from '@paradox/launcher';
import {
  Button,
  Input,
  Select,
  Field,
  DragRegion,
  UiView,
  Dialog,
} from '@paradox/ui';
import FileTree from './FileTree';
import SourceEditor from './SourceEditor';
import AssetManager from './AssetManager';
import TargetCatalog from './TargetCatalog';
import TargetDetails from './TargetDetails';
import './style.css';
export default function Editor() {
  const s = useUiEditorSnapshot(),
    a = useUiEditorActions();
  const [name, setName] = useState('My suite'),
    [path, setPath] = useState('New.tsx'),
    [nextPath, setNextPath] = useState(''),
    [kind, setKind] = useState('tsx');
  const authoritativeManifest = JSON.stringify(s.draft?.manifest ?? {});
  const [manifestReset, setManifestReset] = useState(0);
  const [manifestInput, setManifestInput] = useState(() => ({
    suiteId: s.selectedSuiteId,
    authoritativeManifest,
    reset: manifestReset,
    text: JSON.stringify(s.draft?.manifest ?? {}, null, 2),
  }));
  if (
    manifestInput.suiteId !== s.selectedSuiteId ||
    manifestInput.authoritativeManifest !== authoritativeManifest ||
    manifestInput.reset !== manifestReset
  ) {
    setManifestInput({
      suiteId: s.selectedSuiteId,
      authoritativeManifest,
      reset: manifestReset,
      text: JSON.stringify(s.draft?.manifest ?? {}, null, 2),
    });
  }
  const { t } = useTranslation();
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const notifications = useLauncherActions().notifications;
  const notify = (result: Promise<boolean>, key: string) => result.then((ok) => { if (ok) notifications.publish('success', t(key)); });
  const pending = !!s.pending;
  if (s.picking) return <aside data-ui-site="Editor-picking" className="ui-pick-hint"><p data-ui-site="Editor-pick-instruction">{t('uiSuiteEditor.pickHint')}</p><span data-ui-inspector-controls="" data-ui-site="Editor-pick-controls"><Button data-ui-site="Editor-cancel-pick" onClick={() => a.cancelPick()}>{t('uiSuiteEditor.cancelPick')}</Button></span><TargetDetails data-ui-site="Editor-pick-details" /></aside>;
  return (
    <Dialog.Root data-ui-site="Editor-dialog" open modal onOpenChange={(open) => { if (!open) a.close(); }}>
      <Dialog.Portal data-ui-site="Editor-portal" style={{ '--ui-notice-viewport-bottom': '70px', '--ui-notice-viewport-max-height': 'calc(100dvh - 130px)' } as CSSProperties}>
      <Dialog.Popup data-ui-site="Editor-1" className="suite-editor ui-editor" aria-label={t('uiSuiteEditor.title')}>
      <header data-ui-site="Editor-header">
      <DragRegion data-ui-site="Editor-2" className="suite-editor-title">
        <Dialog.Title data-ui-site="Editor-3" render={<h1 />}>{t('uiSuiteEditor.title')}</Dialog.Title>
        <span data-ui-site="Editor-4">
          {s.dirty ? 'Unsaved changes' : ''}
          {s.previewing ? ' · Preview' : ''}
        </span>
        <Button data-ui-site="Editor-5" onClick={() => void a.close()}>
          {t('uiSuiteEditor.close')}
        </Button>
      </DragRegion>
      </header>
      <div data-ui-site="Editor-body" className="ui-editor-body">
      <div data-ui-site="Editor-6" className="suite-editor-toolbar">
        <Field data-ui-site="Editor-7" label={t('uiSuiteEditor.suite')}>
          <Select
            data-ui-site="Editor-8"
            aria-label={t('uiSuiteEditor.suite')}
            value={s.selectedSuiteId ?? ''}
            options={s.suites.map((suite) => ({ value: suite.id, label: suite.name }))}
            placeholder="User suite"
            onValueChange={(id) => void a.selectSuite(id)}
          />
        </Field>
        <Input
          data-ui-site="Editor-9"
          aria-label={t('uiSuiteEditor.copyName')}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Button
          data-ui-site="Editor-10"
          disabled={pending}
          onClick={() =>
            void a.copyBuiltin(
              s.selectedSuiteId === 'builtin.immersive' ? 'immersive' : 'modern',
              name,
            )
          }
        >
          {t('uiSuiteEditor.copy')}
        </Button>
        <label data-ui-site="Editor-11">
          {t('uiSuiteEditor.import')}
          <input
            data-ui-site="Editor-12"
            type="file"
            accept=".paradox-ui"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) void notify(a.importBundle(f), 'uiSuiteEditor.imported');
              e.currentTarget.value = '';
            }}
          />
        </label>
        <Button data-ui-site="Editor-13" disabled={pending} onClick={() => void a.exportDraft()}>
          {t('uiSuiteEditor.export')}
        </Button>
        <Button
          data-ui-site="Editor-16"
          disabled={pending}
          onClick={() =>
            void a.revert().then((reverted) => {
              if (reverted) setManifestReset((value) => value + 1);
            })
          }
        >
          {t('uiSuiteEditor.revert')}
        </Button>
        <Button data-ui-site="Editor-17" onClick={() => void a.requestReset()}>
          {t('uiSuiteEditor.reset')}
        </Button>
      </div>
      <div data-ui-site="Editor-18" className="suite-editor-files">
        <Input
          data-ui-site="Editor-19"
          aria-label={t('uiSuiteEditor.newPath')}
          value={path}
          onChange={(e) => setPath(e.currentTarget.value)}
        />
        <Select
          data-ui-site="Editor-20"
          aria-label={t('uiSuiteEditor.newType')}
          value={kind}
          options={['tsx', 'ts', 'css', 'html'].map((value) => ({ value, label: value }))}
          onValueChange={setKind}
        />
        <Button data-ui-site="Editor-21" onClick={() => void a.createFile(path, kind as 'tsx')}>
          {t('uiSuiteEditor.createFile')}
        </Button>
        <Input
          data-ui-site="Editor-22"
          aria-label={t('uiSuiteEditor.renameTo')}
          value={nextPath}
          onChange={(e) => setNextPath(e.currentTarget.value)}
        />
        <Button
          data-ui-site="Editor-23"
          disabled={!s.selectedFile}
          onClick={() => s.selectedFile && a.renameFile(s.selectedFile, nextPath)}
        >
          {t('uiSuiteEditor.rename')}
        </Button>
        <Button
          data-ui-site="Editor-24"
          disabled={!s.selectedFile}
          onClick={() => s.selectedFile && a.removeFile(s.selectedFile)}
        >
          {t('uiSuiteEditor.remove')}
        </Button>
      </div>
      <div data-ui-site="Editor-25" className="suite-editor-grid">
        <UiView data-ui-site="Editor-26" id="tool.editor.files" Original={FileTree} />
        <UiView data-ui-site="Editor-27" id="tool.editor.source" Original={SourceEditor} />
        <UiView data-ui-site="Editor-28" id="tool.editor.assets" Original={AssetManager} />
      </div>
      <Field data-ui-site="Editor-29" label={t('uiSuiteEditor.manifest')}>
        <textarea
          data-ui-site="Editor-30"
          aria-label={t('uiSuiteEditor.manifest')}
          key={s.selectedSuiteId}
          value={manifestInput.text}
          onChange={(e) => {
            const input = {
              suiteId: s.selectedSuiteId,
              authoritativeManifest,
              reset: manifestReset,
              text: e.currentTarget.value,
            };
            try {
              const patch = JSON.parse(input.text) as Parameters<typeof a.patchManifest>[0];
              const expected = JSON.parse(authoritativeManifest) as Record<string, unknown>;
              // Recognize this input's synchronous public patch without replacing its formatting.
              for (const key of ['id', 'version', 'name', 'views', 'routes', 'styles', 'overrides'] as const)
                if (s.draft && Object.hasOwn(patch, key)) expected[key] = patch[key];
              setManifestInput({ ...input, authoritativeManifest: JSON.stringify(expected) });
              a.patchManifest(patch);
            } catch {
              setManifestInput(input);
              /* Invalid text remains presentation only; use sources for full edits. */
            }
          }}
        />
      </Field>
      <TargetCatalog data-ui-site="Editor-target-catalog" />
      <Button data-ui-site="Editor-34" onClick={() => (s.picking ? a.cancelPick() : a.beginPick())}>{s.picking ? t('uiSuiteEditor.cancelPick') : t('uiSuiteEditor.pick')}</Button>
      <TargetDetails data-ui-site="Editor-target-details" />
      <Button data-ui-site="Editor-38" aria-expanded={diagnosticsOpen} onClick={() => setDiagnosticsOpen((open) => !open)}>{t('uiSuiteEditor.viewDiagnostics', { count: s.diagnostics.length })}</Button>
      <section data-ui-site="Editor-37" className="ui-diagnostics" hidden={!diagnosticsOpen}>
          <h2 data-ui-site="Editor-diagnostic-title">{t('uiSuiteEditor.diagnostics')}</h2>
          {s.diagnostics.length === 0 && <p data-ui-site="Editor-no-diagnostics">{t('uiSuiteEditor.noDiagnostics')}</p>}
          <ul data-ui-site="Editor-39">
            {s.diagnostics.map((d, i) => (
              <li data-ui-site="Editor-40" key={i}>
                {d}
              </li>
            ))}
          </ul>
          <Button data-ui-site="Editor-41" onClick={() => void a.clearDiagnostics()}>
            {t('uiSuiteEditor.clearDiagnostics')}
          </Button>
        </section>
      {s.resetConfirmationOpen && (
        <section data-ui-site="Editor-42" role="alertdialog" aria-label={t('uiSuiteEditor.resetTitle')}>
          <p data-ui-site="Editor-43">{t('uiSuiteEditor.resetQuestion')}</p>
          <Button data-ui-site="Editor-44" onClick={() => void a.confirmReset()}>
            {t('uiSuiteEditor.confirmReset')}
          </Button>
          <Button data-ui-site="Editor-45" onClick={() => void a.cancelReset()}>
            {t('uiSuiteEditor.cancelReset')}
          </Button>
        </section>
      )}
      </div>
      <footer data-ui-site="Editor-footer">
        <span data-ui-site="Editor-state">{s.previewing ? t('uiSuiteEditor.previewing') : s.dirty ? t('uiSuiteEditor.unsaved') : t('uiSuiteEditor.synced')}</span>
        <Button data-ui-site="Editor-14" disabled={pending} onClick={() => void notify(a.preview(), 'uiSuiteEditor.previewDone')}>{t('uiSuiteEditor.preview')}</Button>
        <Button data-ui-site="Editor-15" className="primary" disabled={pending || !!s.selectedSuiteId?.startsWith('builtin.')} onClick={() => void notify(a.save(), 'uiSuiteEditor.saved')}>{t('uiSuiteEditor.save')}</Button>
      </footer>
      <UiView data-ui-site="Editor-46" id="host.notifications" />
      </Dialog.Popup></Dialog.Portal>
    </Dialog.Root>
  );
}
