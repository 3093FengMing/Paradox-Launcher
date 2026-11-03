import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n';
import App from './App';
import LauncherProvider from './launcher/LauncherProvider';
import { UiEditorProvider, UiEditorSourceContext } from './ui-editor/controller';
import { getBuiltinBundle } from './ui-suite/builtins';
import './window.css';
import './scrollbars.css';
import './ui-foundation/foundation.css';

const FinalCapture = import.meta.env.MODE === 'foundation-test'
  ? React.lazy(() => import('./ui-tests/suite-final-fixture').then((module) => ({ default: module.Capture })))
  : null;

if (import.meta.env.MODE === 'foundation-test') void import('./ui-foundation/browser-fixture');
if (import.meta.env.MODE === 'ownership-test')
  void import('./ui-tests/ownership-fixture').then(({ installOwnershipFixture }) =>
    installOwnershipFixture(),
  );
if (import.meta.env.MODE === 'ownership-test')
  void import('./ui-tests/suite-compiler-fixture').then(({ installSuiteCompilerFixture }) =>
    installSuiteCompilerFixture(),
  );

// Private entry ownership; dev fixtures reuse this root instead of mounting a
// competing launcher. It is never part of either public module barrel.
export const root = ReactDOM.createRoot(document.getElementById('root')!);
if (import.meta.env.MODE === 'foundation-test')
  void import('./ui-tests/launcher-view-fixture').then(({ installLauncherFixture }) =>
    installLauncherFixture(root),
  );

if (import.meta.env.MODE === 'suite-builtins-test')
  void import('./ui-tests/suite-builtins-fixture').then(({ installSuiteBuiltinsFixture }) =>
    installSuiteBuiltinsFixture(root),
  );
else if (import.meta.env.MODE === 'suite-views-test')
  void import('./ui-tests/suite-views-fixture').then(({ installSuiteViewsFixture }) =>
    installSuiteViewsFixture(root),
  );
else if (import.meta.env.MODE === 'editor-test')
  void import('./ui-tests/editor-fixture').then(({ installEditorFixture }) =>
    installEditorFixture(root),
  );
else
  root.render(
    <React.StrictMode>
      <LauncherProvider initialRouteRegistry="suite">
        <UiEditorSourceContext.Provider value={{ getBuiltinBundle }}>
          <UiEditorProvider>
            <App />
            {FinalCapture && <React.Suspense fallback={null}><FinalCapture /></React.Suspense>}
          </UiEditorProvider>
        </UiEditorSourceContext.Provider>
      </LauncherProvider>
    </React.StrictMode>,
  );
