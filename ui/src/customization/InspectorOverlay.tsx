/** @jsxImportSource react */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { UiTargetDescriptor } from '../ui-editor/public';

/** Protected range drawing only; names, hierarchy and controls live in editor source. */
export default function InspectorOverlay({ target, rects }: { target: UiTargetDescriptor | null; rects: readonly DOMRectReadOnly[] }): React.JSX.Element {
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);
  useEffect(() => {
    const host = document.createElement('div');
    host.setAttribute('data-ui-inspector-artifact', 'range');
    host.setAttribute('aria-hidden', 'true'); host.inert = true;
    host.style.cssText = 'all:initial!important;display:block!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;visibility:visible!important;opacity:1!important;transform:none!important;';
    setShadow(host.attachShadow({ mode: 'open' })); document.body.append(host);
    return () => host.remove();
  }, []);
  return <>{shadow && createPortal(<>{rects.map((rect, index) => <div key={index} data-ui-inspector-rect="" data-ui-inspector-target={target?.selector.target} style={{ position: 'fixed', pointerEvents: 'none', boxSizing: 'border-box', border: '2px solid #6da8ff', background: '#6da8ff22', left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />)}</>, shadow)}</>;
}
