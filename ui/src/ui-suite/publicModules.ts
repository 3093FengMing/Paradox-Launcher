import * as React from 'react';
import * as jsxRuntime from '../customization/jsx-runtime';
import * as icons from 'lucide-react';
import * as ui from '../ui-foundation/index';
import * as launcher from '../launcher/public/index';
import { useTranslation } from 'react-i18next';

const modules: Readonly<Record<string, unknown>> = Object.freeze({
  react: React,
  'react/jsx-runtime': jsxRuntime,
  'lucide-react': icons,
  '@paradox/ui': ui,
  '@paradox/launcher': launcher,
  'react-i18next': Object.freeze({ useTranslation }),
});
export function loadPublicModules(): Readonly<Record<string, unknown>> {
  return modules;
}
Object.defineProperty(globalThis, Symbol.for('paradox.ui.modules'), {
  value: modules,
  configurable: true,
});
