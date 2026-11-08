import { viewProps } from '../../common/lib/view';
export default function StylePreview(input: { props?: Readonly<Record<string, unknown>>; style?: 'modern' | 'immersive' }) {
  const { style = 'modern' } = viewProps<{ style?: 'modern' | 'immersive' }>(input);
  return <div className={`onboarding-style-preview style-preview-${style}`} aria-hidden="true">
    <div className="style-preview-chrome"><i /><span>− □ ×</span></div>
    <div className="style-preview-body"><div className="style-preview-rail"><b /><i /><i /><i /><i /></div>
      <div className="style-preview-content"><div className="style-preview-heading" />
        {style === 'modern' && <div className="style-preview-tiles"><i /><i /></div>}
        <div className="style-preview-play">{style === 'immersive' && <span />}</div>
      </div>
    </div>
  </div>;
}
