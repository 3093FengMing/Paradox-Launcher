/** @jsxImportSource react */
// Loaded only by the explicit foundation-test build or the browser test's dev import.
import { StrictMode, useEffect, useRef, useState } from 'react';
import type { DialogRootActions } from '@base-ui/react/dialog';
import { createRoot, type Root } from 'react-dom/client';
import * as controls from './index';
import css from './foundation.css?inline';
import tokens from '../tokens.css?inline';
import PersonalizationSettings from '../components/PersonalizationSettings';
import { defaultPersonalization } from '../lib/preferences';
import { builtinRoutes } from '../lib/navigation';
import { createNoticeStore, retainNoticeStore } from '../ui-runtime/notices';
import type { UiNoticeStore } from '../ui-runtime/notices';
import NoticeViewport from '../ui-runtime/NoticeViewport';

declare global {
  interface Window {
    foundationFixture?: Root;
    foundationTrigger?: HTMLButtonElement | null;
    foundationSubmitted?: Record<string, FormDataEntryValue>;
    foundationNativeSubmitted?: Record<string, FormDataEntryValue>;
    foundationRefs?: Record<string, HTMLElement | null>;
    foundationEvents?: string[];
    foundationValueChanges?: string[];
    foundationDialogActions?: DialogRootActions | null;
    foundationDialogGuard?: boolean;
    foundationDialogChanges?: { open: boolean; reason: string; canceled: boolean }[];
    mountFoundationFixture?: (theme: 'light' | 'dark', shadow: boolean, dialog?: boolean) => void;
    mountNoticeFixture?: (options?: {
      fixed?: boolean;
      portal?: boolean;
      container?: Element | DocumentFragment;
    }) => void;
    mountDragFixture?: () => void;
    dragFixture?: {
      events: string[];
      preventMouseDown: boolean;
      preventDoubleClick: boolean;
      unmount(): void;
    };
    noticeFixture?: {
      store: UiNoticeStore;
      advance(ms: number): void;
      views(count: number, removeFirst?: boolean): void;
      unmount(): void;
      actions: number;
    };
  }
}
window.mountDragFixture = () => {
  window.dragFixture?.unmount();
  const host = document.createElement('div');
  host.id = 'drag-fixture';
  host.style.cssText =
    'position:fixed;inset:60px 20px;z-index:2147483647;background:#202532;color:white;padding:20px;user-select:none';
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const root = createRoot(shadow);
  window.dragFixture = {
    events: [],
    preventMouseDown: false,
    preventDoubleClick: false,
    unmount() {
      root.unmount();
      host.remove();
    },
  };
  root.render(
    <div role="button">
      <controls.DragRegion
        aria-label="Guarded drag region"
        style={{ padding: 24 }}
        onMouseDown={(event) => {
          window.dragFixture!.events.push('mousedown');
          if (window.dragFixture!.preventMouseDown) event.preventDefault();
        }}
        onDoubleClick={(event) => {
          window.dragFixture!.events.push('doubleclick');
          if (window.dragFixture!.preventDoubleClick) event.preventDefault();
        }}
      >
        <div data-drag-blank style={{ height: 32 }}>
          Blank drag space
        </div>
        <button aria-label="Nested SVG button">
          <svg width="20" height="20">
            <path d="M0 0h20v20H0z" />
          </svg>
        </button>
        <span role="switch" aria-checked="false">
          Interactive role
        </span>
        <label>
          Label text
          <input aria-label="Nested input" />
        </label>
        <select aria-label="Nested select">
          <option>Native select</option>
        </select>
        <textarea aria-label="Nested textarea" />
        <a href="#drag-fixture">Nested link</a>
        <details>
          <summary>Nested summary</summary>
        </details>
        <span contentEditable suppressContentEditableWarning>
          Editable text
        </span>
        <span tabIndex={0}>Focusable content</span>
        <div data-drag-child-cancel onMouseDown={(event) => event.preventDefault()}>
          Child cancels drag
        </div>
      </controls.DragRegion>
    </div>,
  );
};
window.mountNoticeFixture = (options = {}) => {
  window.noticeFixture?.unmount();
  const host = document.createElement('div');
  host.id = 'notice-fixture';
  host.style.cssText = options.container
    ? 'position:fixed;inset:0;z-index:2147483647;pointer-events:none'
    : 'position:fixed;inset:0;z-index:2147483647;background:#202532;color:white;padding:20px';
  document.body.append(host);
  const portalHost = options.portal ? document.createElement('div') : null;
  if (portalHost) {
    portalHost.id = 'notice-portal';
    host.append(portalHost);
  }
  const portalContainer = options.container ?? portalHost?.attachShadow({ mode: 'open' });
  const mount = document.createElement('div');
  host.append(mount);
  let now = 0,
    sequence = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const store = createNoticeStore({
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++sequence;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id as number);
    },
  });
  const root = createRoot(mount);
  function Scene() {
    const [views, setViews] = useState([0]);
    useEffect(() => retainNoticeStore(store), []);
    window.noticeFixture!.views = (count, removeFirst = false) =>
      setViews(removeFirst ? [1] : Array.from({ length: count }, (_, i) => i));
    return (
      <>
        {!options.fixed && (
          <style>
            {'[data-notice-view] .ui-notice-viewport { position:relative;right:auto;bottom:auto; }'}
          </style>
        )}
        {!options.container && (
          <button
            type="button"
            onClick={() => {
              window.noticeFixture!.actions++;
            }}
          >
            Outside notice
          </button>
        )}
        {views.map((id) => (
          <div key={id} data-notice-view={id}>
            <NoticeViewport store={store} portalContainer={portalContainer} />
          </div>
        ))}
      </>
    );
  }
  window.noticeFixture = {
    store,
    actions: 0,
    views() {},
    unmount() {
      root.unmount();
      host.remove();
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
      }
      now = end;
    },
  };
  root.render(
    <StrictMode>
      <Scene />
    </StrictMode>,
  );
};
window.mountFoundationFixture = (theme, shadow, dialog = false) => {
  window.foundationFixture?.unmount();
  document.getElementById('foundation-fixture')?.remove();
  const host = document.createElement('div');
  host.id = 'foundation-fixture';
  host.dataset.theme = theme;
  host.style.cssText =
    'position:fixed;inset:16px;z-index:2147483647;padding:16px;overflow:auto;background:var(--bg);color:var(--text);font:14px system-ui';
  document.body.append(host);
  const rootNode = shadow ? host.attachShadow({ mode: 'open' }) : host;
  const style = document.createElement('style');
  style.textContent = tokens + css;
  rootNode.append(style);
  const mount = document.createElement('div');
  rootNode.append(mount);
  const root = createRoot(mount);
  window.foundationFixture = root;
  window.foundationSubmitted = undefined;
  window.foundationNativeSubmitted = undefined;
  window.foundationRefs = {};
  window.foundationEvents = [];
  window.foundationValueChanges = [];
  window.foundationDialogGuard = false;
  window.foundationDialogActions = null;
  window.foundationDialogChanges = [];
  function DialogScene() {
    const actions = useRef<DialogRootActions | null>(null);
    const [value, setValue] = useState('b');
    return (
      <controls.Dialog.Root
        defaultOpen
        actionsRef={actions}
        onOpenChange={(open, details) => {
          if (!open && window.foundationDialogGuard) details.cancel();
          window.foundationDialogChanges!.push({
            open,
            reason: details.reason,
            canceled: details.isCanceled,
          });
        }}
      >
        <controls.Dialog.Portal>
          <controls.Dialog.Popup
            aria-label="Action Dialog"
            finalFocus={false}
            style={{ position: 'relative', zIndex: 1, padding: 16 }}
          >
            <controls.Dialog.Close>Close action Dialog</controls.Dialog.Close>
            <controls.Button
              onClick={() => {
                window.foundationDialogActions = actions.current;
              }}
            >
              Expose Dialog actions
            </controls.Button>
            <controls.Select
              aria-label="Action choice"
              value={value}
              onValueChange={setValue}
              options={[
                { value: 'b', label: 'Beta' },
                { value: 'c', label: 'Gamma' },
              ]}
            />
          </controls.Dialog.Popup>
        </controls.Dialog.Portal>
      </controls.Dialog.Root>
    );
  }
  function Scene() {
    const [value, setValue] = useState('');
    const [disabled, setDisabled] = useState(false);
    const [personalization, setPersonalization] = useState(defaultPersonalization);
    const [checked, setChecked] = useState(false);
    const [range, setRange] = useState(20);
    return (
      <controls.UiFoundationProvider
        value={{
          theme,
          variables: { '--accent': '#5b8f14' } as React.CSSProperties,
          portalContainer: rootNode,
          protectedMode: false,
        }}
      >
        {dialog ? (
          <DialogScene />
        ) : (
          <controls.Panel className="fixture-panel">
            <form
              id="foundation-form"
              onSubmit={(event) => {
                event.preventDefault();
                window.foundationSubmitted = Object.fromEntries(new FormData(event.currentTarget));
              }}
            >
              <controls.Field label="Choice" description="Pick a permitted option">
                <div>
                  <controls.Select
                    value={value}
                    onValueChange={(next) => {
                      window.foundationValueChanges!.push(next);
                      setValue(next);
                    }}
                    required
                    disabled={disabled}
                    id="choice"
                    name="choice"
                    ref={(element) => {
                      window.foundationTrigger = element;
                    }}
                    placeholder="Choose"
                    options={[
                      { value: '', label: 'Empty' },
                      { value: 'a', label: 'Alpha disabled', disabled: true },
                      { value: 'b', label: 'Beta' },
                      { value: 'c', label: 'Gamma' },
                    ]}
                  />
                </div>
              </controls.Field>
              <controls.Button type="submit">Submit</controls.Button>
              <controls.Button onClick={() => setDisabled((current) => !current)}>
                Toggle disabled
              </controls.Button>
              <controls.Button onClick={() => setValue('missing')}>Set missing</controls.Button>
            </form>
            <form
              id="foundation-native-form"
              onSubmit={(event) => {
                event.preventDefault();
                window.foundationNativeSubmitted = Object.fromEntries(
                  new FormData(event.currentTarget),
                );
              }}
            >
              <controls.Field label="Native input" description="Native help">
                <controls.Input
                  name="native-input"
                  required
                  minLength={2}
                  maxLength={20}
                  defaultValue=""
                  ref={(element) => {
                    window.foundationRefs!.input = element;
                  }}
                  onChange={() => window.foundationEvents!.push('input')}
                />
              </controls.Field>
              <controls.Field label="Native text area">
                <controls.TextArea
                  name="native-textarea"
                  required
                  defaultValue=""
                  ref={(element) => {
                    window.foundationRefs!.textarea = element;
                  }}
                  onChange={() => window.foundationEvents!.push('textarea')}
                />
              </controls.Field>
              <controls.Button
                type="submit"
                ref={(element) => {
                  window.foundationRefs!.button = element;
                }}
                onClick={() => window.foundationEvents!.push('button')}
              >
                Native submit
              </controls.Button>
              <controls.IconButton
                aria-label="Native icon"
                ref={(element) => {
                  window.foundationRefs!.icon = element;
                }}
                onClick={() => window.foundationEvents!.push('icon')}
              >
                +
              </controls.IconButton>
            </form>
            <controls.Checkbox
              label="Check choice"
              checked={checked}
              onChange={setChecked}
              disabled={disabled}
            />
            <controls.Toggle
              label="Toggle choice"
              checked={checked}
              onChange={setChecked}
              disabled={disabled}
            />
            <controls.Slider
              label="Range choice"
              value={range}
              min={0}
              max={100}
              step={10}
              onValueChange={setRange}
              disabled={disabled}
            />
            <controls.Progress value={range} label="Progress choice" />
            <PersonalizationSettings
              routes={builtinRoutes}
              onSetStartupRoute={(id) =>
                setPersonalization((current) => ({ ...current, startup_page: id }))
              }
              value={personalization}
              section="appearance"
              desktop
              disabled={disabled}
              choosing={false}
              background={null}
              onPatch={(key, value) =>
                setPersonalization((current) => ({ ...current, [key]: value }))
              }
              onChooseBackground={() => {}}
            />
          </controls.Panel>
        )}
      </controls.UiFoundationProvider>
    );
  }
  root.render(<Scene />);
};
