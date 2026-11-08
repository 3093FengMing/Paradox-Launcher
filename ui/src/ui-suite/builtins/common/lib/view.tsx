import { createElement } from 'react';
import type { ComponentType } from 'react';
import { UiIdentity, UiView } from '@paradox/ui';
/** Only detached visual props; business sources independently read public hooks. */
export function viewProps<T extends object>(input?: object): T {
  return ((
    input as
      | {
          props?: Readonly<Record<string, unknown>>;
        }
      | undefined
  )?.props ??
    input ??
    {}) as T;
}
export function sourceView<P extends object = Record<string, unknown>>(
  id: string,
  Original: unknown,
) {
  return function SourceView(props: P) {
    const values = props as Record<string, unknown>;
    const profile = values.profile as { instance_key?: string } | undefined;
    const account = values.account as { id?: string } | undefined;
    const identity = profile?.instance_key ?? account?.id;
    const view = createElement(UiView, {
      id,
      props: props as Record<string, unknown>,
      Original: Original as ComponentType<Record<string, unknown>>,
    });
    return identity ? createElement(UiIdentity, {
      namespace: profile?.instance_key ? 'profile' : 'account', value: identity, children: view,
    }) : view;
  };
}
