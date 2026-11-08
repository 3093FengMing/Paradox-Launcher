import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiEditorActions, useUiEditorSnapshot } from '@paradox/launcher';
import { UiView } from '@paradox/ui';
import './style.css';
export default function StyleChoice() {
  const { t } = useTranslation(), actions = useUiEditorActions(), editor = useUiEditorSnapshot();
  const [selected, setSelected] = useState('immersive');
  const pending = editor.pending !== null;
  return <main className="style-choice modern-style-choice" data-style-choice aria-labelledby="style-choice-title">
    <form className="style-choice-form" onSubmit={event => { event.preventDefault(); if (!pending) void actions.selectSuite(`builtin.${selected}`); }}>
      <header><h1 id="style-choice-title">{t('onboarding.title')}</h1><p>{t('onboarding.description')}</p></header>
      <fieldset className="style-choice-options" disabled={pending} aria-label={t('onboarding.title')}>
        {['modern', 'immersive'].map(style => <label key={style} className="style-choice-card" data-selected={selected === style}>
          <input type="radio" name="interface-style" value={style} checked={selected === style} autoFocus={style === 'immersive'} onChange={() => setSelected(style)} />
          <strong>{t(`onboarding.${style}`)}</strong>
          {style === 'immersive' && <span className="style-choice-recommended">{t('onboarding.recommended')}</span>}
          <UiView id="component.style-preview" props={{ style }} />
          <span className="style-choice-purpose">{t(`onboarding.${style}Purpose`)}</span>
        </label>)}
      </fieldset>
      <div className="style-choice-footer">
        {editor.diagnostics.length > 0 && <p className="style-choice-error" role="alert">{editor.diagnostics.at(-1)}</p>}
        <button type="submit" className="primary" disabled={pending} aria-busy={pending}>{t(pending ? 'onboarding.saving' : 'onboarding.confirm')}</button>
      </div>
    </form>
  </main>;
}
