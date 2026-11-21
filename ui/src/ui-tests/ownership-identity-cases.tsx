import { resolveSelector } from '../customization/ownership';

import { check, equal, position, tick } from './ownership-support';
import {
  Fields,
  KeyRows,
  EquivalentKey,
  BusinessParent,
} from './ownership-components';
import type { OwnershipCaseContext } from './ownership-support';
export async function checkFieldCallPaths(context: OwnershipCaseContext) {
  const { checks, evidence, mount, render, own } = context;
  const fields = <Fields data-ui-site="fields" />;
  render(fields);
  await tick();
  const labels = own().filter((row) => row.target === 'element.label');
  check(labels.length === 2, 'two actual Field labels register');
  check(
    !equal(labels[0].locator, labels[1].locator),
    'same account Field call paths differ',
  );
  check(
    labels.every((row) =>
      row.locator.business.some(
        (identity) =>
          identity.namespace === 'account' && identity.value === 'same',
      ),
    ),
    'business ancestry survives both fields',
  );
  const saved = labels.map((row) => row.locator);
  render(null);
  render(fields);
  await tick();
  check(
    equal(
      saved,
      own()
        .filter((row) => row.target === 'element.label')
        .map((row) => row.locator),
    ),
    'remount retains locator',
  );
  const firstInput = mount.querySelector('input')!;
  check(
    firstInput.getAttribute('aria-labelledby') !== null,
    'Field association retained',
  );
  evidence.fieldLocators = saved;
  checks.push('field_call_paths_business_and_remount');
}

export async function checkRepeatKeys(context: OwnershipCaseContext) {
  const { checks, evidence, mount, render, at } = context;
  const rows = (items: string[], keys = true) => (
    <KeyRows data-ui-site="keyrows" items={items} keys={keys} />
  );
  render(rows(['a', 'b']));
  await tick();
  const initial = at('row'),
    a = initial.find((row) => [...row.roots][0]?.textContent === 'a')!;
  const aElement = [...a.roots][0];
  render(rows(['b', 'a']));
  await tick();
  const reordered = resolveSelector(position(a));
  check(
    reordered.status === 'resolved' && reordered.owners[0].roots.has(aElement),
    'keyed reorder follows same DOM and locator',
  );
  render(rows(['a', 'a']));
  await tick();
  check(
    resolveSelector(position(at('row')[0])).status === 'ambiguous',
    'duplicate key is ambiguous',
  );
  render(null);
  await tick();
  render(rows(['a', 'b'], false));
  await tick();
  check(
    resolveSelector(position(at('row')[0])).status === 'unsupported',
    'unkeyed repeat unsupported',
  );
  const missingPosition = position(at('row')[0]);
  render(rows(['b'], false));
  await tick();
  check(
    resolveSelector(missingPosition).status === 'unsupported',
    'detected unkeyed list remains unsupported after two to one',
  );
  render(rows(['different'], false));
  await tick();
  check(
    resolveSelector(missingPosition).status === 'unsupported' &&
      mount.querySelector('button')?.textContent === 'different',
    'different remaining item cannot acquire a saved unkeyed precise position',
  );
  render(rows([], false));
  await tick();
  render(rows(['new-after-empty'], false));
  await tick();
  check(
    resolveSelector(missingPosition).status === 'unsupported',
    'same list lifecycle retains repetition history through an empty render',
  );
  render(rows(['keyed-again']));
  await tick();
  check(
    resolveSelector(position(at('row')[0])).status === 'resolved',
    'stable key restores legitimate precise support',
  );
  evidence.unkeyedLifecycle = [
    'two',
    'one',
    'different',
    'empty',
    'new',
    'keyed',
  ];
  checks.push('keyed_reorder_duplicate_and_missing_keys');
}

export async function checkKeyEquivalence(context: OwnershipCaseContext) {
  const { checks, render, at } = context;
  const keyView = (itemKey: string | number | bigint) => (
    <EquivalentKey data-ui-site="equivalent-call" itemKey={itemKey} />
  );
  render(keyView(7));
  await tick();
  const numeric = at('equivalent-key')[0],
    numericElement = [...numeric.roots][0];
  render(keyView('7'));
  await tick();
  check(
    equal(at('equivalent-key')[0].locator, numeric.locator) &&
      at('equivalent-key')[0].roots.has(numericElement),
    'number/string React keys are equivalent',
  );
  render(keyView(7n));
  await tick();
  check(
    equal(at('equivalent-key')[0].locator, numeric.locator) &&
      at('equivalent-key')[0].roots.has(numericElement),
    'bigint React key is equivalent',
  );
  const businessRows = ['a', 'b'].map((account) => (
    <BusinessParent
      data-ui-site="business-parent"
      account={account}
      key={account}
    />
  ));
  render(businessRows);
  await tick();
  const businessChildren = at('same-child-key');
  check(
    businessChildren.length === 2 &&
      !equal(businessChildren[0].locator, businessChildren[1].locator) &&
      businessChildren.every((row) => row.locator.business.length === 1),
    'equal child keys retain distinct business parents',
  );
  checks.push('react_key_equivalence_and_business_parent_accumulation');
}
