import { createElement, Fragment } from 'react';
import type { ReactNode, Ref } from 'react';
import { createPortal } from 'react-dom';
import { Field, Input, UiIdentity } from '@paradox/ui';
import { customComponent } from '../customization/Customizable';
export function Pair({ second = true }: { second?: boolean }) {
  return (
    <Fragment data-ui-site="pair">
      <span data-ui-site="pair-a">A</span>
      {second && <span data-ui-site="pair-b">B</span>}
    </Fragment>
  );
}
export function Portal({ container }: { container: Element }) {
  return createPortal(
    <span data-ui-site="portal-leaf">Portal</span>,
    container,
  );
}
export function Opaque() {
  return createElement('mark', null, 'opaque');
}
export function Bare() {
  return 'bare text';
}
export function Fields() {
  return (
    <UiIdentity namespace="account" value="same">
      <Field data-ui-site="field-a" label="First">
        <Input data-ui-site="input-a" />
      </Field>
      <Field data-ui-site="field-b" label="Second">
        <Input data-ui-site="input-b" />
      </Field>
    </UiIdentity>
  );
}
export function KeyRows({
  items,
  keys = true,
}: {
  items: string[];
  keys?: boolean;
}) {
  return (
    <section data-ui-site="rows">
      {items.map((value) => (
        <button data-ui-site="row" key={keys ? value : undefined}>
          {value}
        </button>
      ))}
    </section>
  );
}
export function EquivalentKey({
  itemKey,
}: {
  itemKey: string | number | bigint;
}) {
  return (
    <button data-ui-site="equivalent-key" key={itemKey}>
      Same
    </button>
  );
}
export function BusinessParent({ account }: { account: string }) {
  return (
    <UiIdentity namespace="account" value={account}>
      <button data-ui-site="same-child-key" key="child">
        {account}
      </button>
    </UiIdentity>
  );
}
export function CssTree() {
  return (
    <section data-ui-site="css-tree-root">
      <span className="ownership-child" data-ui-site="css-tree-child">
        Child
      </span>
    </section>
  );
}
export function RefInput({ inputRef }: { inputRef: Ref<HTMLInputElement> }) {
  return (
    <input
      data-ui-site="ref-input"
      ref={inputRef}
      defaultValue="preserved"
      aria-label="Ref input"
    />
  );
}
export const OriginalControl = customComponent(
  'control.ownership-original',
  ({ onClick, ...props }: { onClick: () => void; className?: string }) => (
    <button {...props} data-ui-site="original-button" onClick={onClick}>
      Original action
    </button>
  ),
);
export const Inner = customComponent(
  'control.ownership-inner',
  ({ children }: { children?: ReactNode }) => (
    <section data-ui-site="inner-original">{children}</section>
  ),
);
