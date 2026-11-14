import { Box, Minus, Square, X } from 'lucide-react';
import { viewProps } from '../../common/lib/view';
export default function StylePreview(input: { props?: Readonly<Record<string, unknown>>; style?: 'modern' | 'immersive' }) {
  const { style = 'modern' } = viewProps<{ style?: 'modern' | 'immersive' }>(input);
  return <div className={`onboarding-style-preview style-preview-${style}`} aria-hidden="true">
    <div className="style-preview-chrome"><Box size={10} /><div className="style-preview-navigation"><i /><i /><i /></div><span><Minus size={8} /><Square size={7} /><X size={8} /></span></div>
    <div className="style-preview-body">
      {style === 'immersive' ? <><div className="style-preview-summary"><b /><i className="style-preview-heading" /><i /><i /><div className="style-preview-play"><span /></div></div><div className="style-preview-content"><i className="style-preview-heading" /><div className="style-preview-rows"><i /><i /><i /><i /></div></div></>
        : <><div className="style-preview-rail"><b /><i /><i /><i /><i /></div><div className="style-preview-content"><i className="style-preview-heading" /><div className="style-preview-rows"><i /><i /><i /><i /></div></div><div className="style-preview-inspector"><i /><i /><div className="style-preview-play" /><i /></div></>}
    </div>
  </div>;
}
