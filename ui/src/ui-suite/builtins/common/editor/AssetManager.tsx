import { useTranslation } from 'react-i18next';
import { useUiEditorSnapshot, useUiEditorActions } from '@paradox/launcher';
import { Button, UiCatalogPresentation } from '@paradox/ui';
export default function AssetManager() {
  const s = useUiEditorSnapshot(),
    a = useUiEditorActions();
  const { t } = useTranslation();
  return (
    <section data-ui-site="AssetManager-1" className="suite-assets">
      <h2 data-ui-site="AssetManager-2">{t('uiSuiteEditor.assets')}</h2>
      <label data-ui-site="AssetManager-3">
        Add artwork or font
        <input
          data-ui-site="AssetManager-4"
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.svg,.woff,.woff2"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) void a.addAsset(f);
            e.currentTarget.value = '';
          }}
        />
      </label>
      <UiCatalogPresentation data-ui-site="AssetManager-5">
        {s.files
          .filter((f) => f.kind === 'asset')
          .map((f) => (
            <div data-ui-site="AssetManager-6" key={f.path}>
              <Button data-ui-site="AssetManager-7" onClick={() => a.selectFile(f.path)}>
                {f.path}
              </Button>
              <Button
                data-ui-site="AssetManager-8"
                aria-label={'Remove ' + f.path}
                onClick={() => a.removeAsset(f.path)}
              >
                Remove
              </Button>
            </div>
          ))}
      </UiCatalogPresentation>
    </section>
  );
}
