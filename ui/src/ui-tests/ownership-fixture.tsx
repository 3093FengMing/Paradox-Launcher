import { createElement, StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { UiRuntimeRoot, UiRuntimeView } from '../customization/runtime';
import {
  listOwners,
  subscribeOwners,
  getSuiteStyleRoot,
} from '../customization/ownership';

import { check, tick, publication } from './ownership-support';
import {
  checkFieldCallPaths,
  checkRepeatKeys,
  checkKeyEquivalence,
} from './ownership-identity-cases';
import {
  checkFragmentAndPortalRoots,
  checkRefLifecycle,
  checkNestedOriginal,
  checkCatalogBoundaries,
} from './ownership-dom-cases';
import {
  checkCompiledOwnership,
  checkHtmlSourceMetadata,
} from './ownership-compiled-cases';
import {
  checkSelectorStyleBoundaries,
  checkWrapperFreeLayout,
} from './ownership-layout-cases';
export function installOwnershipFixture() {
  window.ownershipFixture = {
    async run() {
      const checks: string[] = [],
        evidence: Record<string, unknown> = {};
      const host = document.createElement('div');
      host.id = 'ownership-acceptance';
      host.style.cssText =
        'position:fixed;inset:10px;background:white;color:black;z-index:2147483600;overflow:auto;padding:16px;';
      document.body.append(host);
      const portalA = document.createElement('div'),
        portalB = document.createElement('div');
      host.append(portalA, portalB);
      const shadow = portalB.attachShadow({ mode: 'open' });
      const shadowContainer = document.createElement('div');
      shadow.append(shadowContainer);
      const foreign = document.createElement('iframe');
      host.append(foreign);
      const foreignBody = foreign.contentDocument!.body;
      const mount = document.createElement('div');
      host.append(mount);
      const root = createRoot(mount);
      let notifications = 0;
      const unsubscribe = subscribeOwners(() => notifications++);
      const render = (children: ReactNode, strict = false) => {
        flushSync(() =>
          root.render(
            createElement(UiRuntimeRoot, {
              id: 'launcher.main',
              children: createElement(UiRuntimeView, {
                publication,
                children: strict
                  ? createElement(StrictMode, null, children)
                  : children,
              }),
            }),
          ),
        );
      };
      const own = () =>
        listOwners().filter((row) => row.viewId === publication.viewId);
      const at = (site: string) =>
        own().filter((row) => row.site?.endsWith(`:${site}`));
      const resources: (() => void)[] = [];
      const styleRoot = (id: 'launcher.main' | 'launcher.editor') => {
        const snapshot = getSuiteStyleRoot(id);
        resources.push(() => snapshot.dispose());
        return snapshot;
      };
      const context = {
        checks,
        evidence,
        host,
        mount,
        portalA,
        shadowContainer,
        foreignBody,
        resources,
        render,
        own,
        at,
        styleRoot,
        notifications: () => notifications,
      };
      try {
        await checkFieldCallPaths(context);
        await checkRepeatKeys(context);
        await checkKeyEquivalence(context);
        await checkFragmentAndPortalRoots(context);
        await checkRefLifecycle(context);
        await checkNestedOriginal(context);
        await checkCatalogBoundaries(context);
        await checkCompiledOwnership(context);
        await checkHtmlSourceMetadata(context);
        await checkSelectorStyleBoundaries(context);
        await checkWrapperFreeLayout(context);
        evidence.finalOwners = own().map((row) => ({
          target: row.target,
          site: row.site,
          roots: row.roots.size,
        }));
        const summary = document.createElement('section');
        summary.innerHTML = '<h2>Ownership acceptance</h2>';
        const list = document.createElement('ol');
        for (const name of checks) {
          const item = document.createElement('li');
          item.textContent = name;
          list.append(item);
        }
        summary.append(list);
        host.append(summary);
        window.ownershipFixture.captureReady = true;
        await new Promise<void>((resolve) => {
          window.ownershipFixture.resume = resolve;
        });
        return { checks, evidence };
      } catch (error) {
        console.error('OWNERSHIP PRIMARY', String(error));
        throw error;
      } finally {
        flushSync(() => root.unmount());
        unsubscribe();
        for (const release of resources.reverse()) release();
        host.remove();
        await tick();
        check(
          !listOwners().some(
            (row) =>
              row.layerId === 'test' ||
              row.layerId === 'runtime' ||
              row.layerId === 'copy' ||
              row.layerId === 'html',
          ),
          'all fixture owners released: ' +
            JSON.stringify(
              listOwners()
                .filter((row) => row.layerId === 'test')
                .map((row) => ({
                  id: row.ownerId,
                  target: row.target,
                  site: row.site,
                })),
            ),
        );
      }
    },
  };
}
declare global {
  interface Window {
    ownershipFixture: {
      run(): Promise<{ checks: string[]; evidence: Record<string, unknown> }>;
      captureReady?: boolean;
      resume?: () => void;
    };
  }
}
