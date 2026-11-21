import { getDomOwnership } from '../customization/ownership';

import { compileSuite } from '../ui-suite/compiler';
import { attachSuiteStyles } from '../ui-suite/prepared';

import { normalizeDraftBundle } from '../ui-suite/bundle';
import type { UiSelector } from '../ui-suite/model';

import { check, position, tick, source, bundle } from './ownership-support';
import { CssTree } from './ownership-components';
import type { OwnershipCaseContext } from './ownership-support';
export async function checkSelectorStyleBoundaries(
  context: OwnershipCaseContext,
) {
  const { checks, resources, render, at, styleRoot } = context;
  render(
    <>
      <CssTree data-ui-site="css-tree-a" />
      <CssTree data-ui-site="css-tree-b" />
    </>,
  );
  await tick();
  const selected = at('css-tree-a')[0],
    other = at('css-tree-b')[0];
  const targetData = await bundle({
    'Home.tsx': source('export default ()=>null'),
    'target.css': source(
      ':scope{border-top:7px solid rgb(1,2,3)}.ownership-child{color:rgb(11,22,33)}',
    ),
  });
  targetData.manifest.overrides = [
    {
      selector: position(selected),
      enabled: true,
      entry: null,
      stylesheet: 'target.css',
    },
  ];
  const targetPrepared = await compileSuite(
    await normalizeDraftBundle(targetData),
  );
  resources.push(() => targetPrepared.dispose());
  const targetDetach = attachSuiteStyles(
    document,
    targetPrepared,
    styleRoot('launcher.main'),
  );
  resources.push(targetDetach);
  await tick();
  const selectedRoot = [...selected.roots][0],
    otherRoot = [...other.roots][0],
    child = selectedRoot.querySelector('span')!;
  check(
    getComputedStyle(selectedRoot).borderTopWidth === '7px' &&
      getComputedStyle(otherRoot).borderTopWidth !== '7px',
    'position CSS matches only complete selected locator',
  );
  check(
    getComputedStyle(child).borderTopWidth !== '7px' &&
      getComputedStyle(child).color === 'rgb(11, 22, 33)',
    'root shorthand remains root-only and descendant containment works',
  );
  check(
    !getDomOwnership(child)!.rootOwnerIds.includes(selected.ownerId),
    'descendants do not consume ancestor root ownership',
  );
  targetDetach();
  check(
    getComputedStyle(selectedRoot).borderTopWidth !== '7px',
    'style detach removes owned target rules',
  );
  checks.push('full_selector_css_root_and_descendant_scope');
}

export async function checkWrapperFreeLayout(context: OwnershipCaseContext) {
  const { checks, evidence, mount, render, at, styleRoot } = context;
  const boundarySelector: UiSelector = {
    kind: 'type',
    target: 'control.future-action',
  };
  const boundary = styleRoot('launcher.main').resolveTarget(boundarySelector)!;
  render(
    <button data-ui-site="css-future" data-ui-target="control.future-action">
      Future target
    </button>,
  );
  await tick();
  check(
    mount.querySelector('button')!.matches(boundary),
    'supported unmounted explicit target boundary matches future actual root',
  );
  check(
    at('css-future')[0].target === 'control.future-action',
    'native owner and source metadata use the explicit target',
  );
  const actual = mount.querySelector('button')!;
  const native = document.createElement('button');
  native.textContent = 'Future target';
  mount.append(native);
  const aRect = actual.getBoundingClientRect(),
    bRect = native.getBoundingClientRect();
  check(
    aRect.width === bRect.width &&
      aRect.height === bRect.height &&
      actual.parentElement === mount,
    'registry adds no DOM/layout wrappers',
  );
  native.remove();
  evidence.layout = {
    registered: [aRect.width, aRect.height],
    ordinary: [bRect.width, bRect.height],
    tag: actual.tagName,
  };
  checks.push('stable_css_boundary_and_no_layout_wrappers');
}
