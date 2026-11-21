import { createElement } from 'react';
import type { Ref } from 'react';

import { UiCatalogPresentation } from '@paradox/ui';

import {
  listOwners,
  getDomOwnership,
  getOwner,
  resolveSelector,
  collectVisibleRects,
} from '../customization/ownership';

import { SuiteViewContext } from '../ui-suite/View';

import { check, position, tick } from './ownership-support';
import {
  Pair,
  Portal,
  Opaque,
  Bare,
  RefInput,
  Inner,
  OriginalControl,
} from './ownership-components';
import type { OwnershipCaseContext } from './ownership-support';
export async function checkFragmentAndPortalRoots(
  context: OwnershipCaseContext,
) {
  const { checks, portalA, shadowContainer, foreignBody, render, at } = context;
  const pairView = (second = true) => (
    <Pair data-ui-site="pair-call" second={second} />
  );
  render(pairView());
  await tick();
  let pair = at('pair-call')[0];
  check(pair.roots.size === 2, 'component Fragment has two roots');
  const before = [...pair.roots];
  render(pairView(false));
  await tick();
  pair = at('pair-call')[0];
  check(
    pair.roots.size === 1 && !pair.roots.has(before[1]),
    'removed Fragment root is released',
  );
  const portalView = (container: Element) => (
    <div data-ui-site="portal-parent">
      <Portal data-ui-site="portal" container={container} />
    </div>
  );
  render(portalView(portalA));
  await tick();
  check(
    at('portal-parent')[0].roots.size === 2,
    'Portal extends logical parent roots beyond DOM subtree',
  );
  const portalId = at('portal')[0].ownerId;
  render(portalView(shadowContainer));
  await tick();
  check(
    getOwner(portalId)?.roots.size === 1 &&
      shadowContainer.textContent === 'Portal' &&
      !portalA.textContent,
    'Portal move removes old root',
  );
  render(portalView(foreignBody));
  await tick();
  check(
    at('portal')[0].roots.size === 1 &&
      collectVisibleRects([at('portal')[0].ownerId]).length > 0,
    'foreign document Portal uses realm-safe roots and rects',
  );
  render(
    <>
      <Opaque data-ui-site="opaque" />
      <Bare data-ui-site="bare" />
    </>,
  );
  await tick();
  check(
    resolveSelector(position(at('opaque')[0])).status === 'unsupported' &&
      resolveSelector(position(at('bare')[0])).status === 'unsupported',
    'opaque/createElement/text stay unsupported',
  );
  checks.push('fragment_portal_foreign_document_and_opaque');
}

export async function checkRefLifecycle(context: OwnershipCaseContext) {
  const { checks, evidence, mount, render } = context;
  let setups = 0,
    cleanups = 0,
    nullCalls = 0;
  const callback = (element: HTMLInputElement | null) => {
    if (!element) {
      nullCalls++;
      return;
    }
    setups++;
    return () => {
      cleanups++;
    };
  };
  const refView = (inputRef: Ref<HTMLInputElement>) => (
    <RefInput data-ui-site="refcall" inputRef={inputRef} />
  );
  render(refView(callback), true);
  await tick();
  const input = mount.querySelector('input')!;
  input.focus();
  input.value = 'draft';
  input.setSelectionRange(1, 3);
  render(refView(callback), true);
  await tick();
  check(
    mount.querySelector('input') === input &&
      document.activeElement === input &&
      input.value === 'draft' &&
      input.selectionStart === 1,
    'rerender preserves input focus/selection/value',
  );
  const objectRef = { current: null as HTMLInputElement | null };
  render(refView(objectRef), true);
  await tick();
  check(
    objectRef.current === input && cleanups === setups && nullCalls === 0,
    'React19 returned cleanup and ref swap',
  );
  render(null);
  await tick();
  check(objectRef.current === null, 'object ref cleared');
  check(!getDomOwnership(input), 'removed DOM ownership cleared');
  evidence.refs = { setups, cleanups, nullCalls };
  checks.push('react19_ref_cleanup_swap_focus_and_forms');
}

export async function checkNestedOriginal(context: OwnershipCaseContext) {
  const { checks, mount, render } = context;
  let calls = 0;
  const onClick = () => calls++;
  const replacements = {
    'control.ownership-original': {
      Component: ({ Original, ...props }: Record<string, unknown>) =>
        createElement(
          Inner,
          null,
          createElement(
            Original as React.ComponentType<Record<string, unknown>>,
            props,
          ),
        ),
    },
    'control.ownership-inner': {
      Component: ({ Original, ...props }: Record<string, unknown>) =>
        createElement(
          'article',
          null,
          createElement(
            Original as React.ComponentType<Record<string, unknown>>,
            props,
          ),
        ),
    },
  };
  render(
    createElement(
      SuiteViewContext.Provider,
      {
        value: ({ id, props, Original }) => {
          const row = replacements[id as keyof typeof replacements];
          return row
            ? createElement(row.Component, { ...props, Original })
            : Original
              ? createElement(Original, props)
              : null;
        },
      },
      <OriginalControl
        data-ui-site="business-control"
        onClick={onClick}
        className="caller"
      />,
    ),
  );
  await tick();
  mount.querySelector('button')!.click();
  check(
    calls === 1 && mount.querySelector('button')!.className === 'caller',
    'nested Original retains callback and caller props',
  );
  checks.push('nested_original_callback_and_props');
}

export async function checkCatalogBoundaries(context: OwnershipCaseContext) {
  const { checks, render, at, notifications } = context;
  render(
    <section data-ui-site="catalog">
      <input data-ui-site="search" />
      <UiCatalogPresentation>
        <button data-ui-site="catalog-item">Generated row</button>
      </UiCatalogPresentation>
    </section>,
  );
  await tick();
  const item = at('catalog-item')[0];
  check(
    item.catalogPresentation && !at('search')[0].catalogPresentation,
    'catalog presentation only generated item subtree',
  );
  check(
    resolveSelector(position(item)).status === 'resolved' &&
      collectVisibleRects([item.ownerId]).length === 1,
    'catalog row remains pickable/resolvable/rect counted',
  );
  const checkpoint = notifications();
  await tick();
  await tick();
  check(notifications() === checkpoint, 'registry notifications settle');
  check(
    !listOwners().some((row) =>
      /launcherprovider|recoveryhost|uifoundationprovider|uiruntimeroot/i.test(
        row.target,
      ),
    ),
    'private roots/providers absent from targets',
  );
  checks.push('catalog_presentation_and_private_boundaries');
}
