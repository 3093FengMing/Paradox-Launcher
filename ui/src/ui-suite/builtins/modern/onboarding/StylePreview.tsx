import { viewProps } from '../../common/lib/view';
export default function StylePreview(input: { props?: Readonly<Record<string, unknown>>; style?: 'modern' | 'immersive' }) {
  const { style = 'modern' } = viewProps<{ style?: 'modern' | 'immersive' }>(input);
  return <div className={`onboarding-style-preview style-preview-${style}`} aria-hidden="true" data-ui-site="StylePreview-root">
    <div className="style-preview-body" data-ui-site="StylePreview-body"><div className="style-preview-rail" data-ui-site="StylePreview-rail"><b data-ui-site="StylePreview-mark"/><i data-ui-site="StylePreview-route-1"/><i data-ui-site="StylePreview-route-2"/><i data-ui-site="StylePreview-route-3"/><i data-ui-site="StylePreview-route-4"/></div>
      <div className="style-preview-content" data-ui-site="StylePreview-content"><div className="style-preview-heading" data-ui-site="StylePreview-heading"/>
        <div className="style-preview-workspace" data-ui-site="StylePreview-workspace"><div className="style-preview-rows" data-ui-site="StylePreview-rows"><i data-ui-site="StylePreview-row-1"/><i data-ui-site="StylePreview-row-2"/><i data-ui-site="StylePreview-row-3"/></div>{style === 'modern' && <div className="style-preview-inspector" data-ui-site="StylePreview-inspector"><i data-ui-site="StylePreview-inspector-title"/><i data-ui-site="StylePreview-inspector-copy"/></div>}</div>
        <div className="style-preview-play" data-ui-site="StylePreview-play">{style === 'immersive' && <span data-ui-site="StylePreview-play-target"/>}</div>
      </div>
    </div>
  </div>;
}
