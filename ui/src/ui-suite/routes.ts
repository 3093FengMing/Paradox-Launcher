import { wellFormed } from '../host/unicode/scalars';
import type { Page } from '../types';

export type UiRouteId = Page | `custom.${string}`;
export interface UiRouteDescriptor {
  id: UiRouteId;
  entry: string;
  title: string;
  description: string;
  navigation: boolean;
  startupSelectable: boolean;
  order: number;
  icon: string | null;
}
export const builtinRouteIds: readonly Page[] = Object.freeze([
  'home',
  'instances',
  'downloads',
  'accounts',
  'settings',
  'logs',
  'content',
]);

/** Syntax is independent of the currently active suite. Never trim persisted IDs. */
export function validateRouteId(value: unknown): UiRouteId {
  if (
    typeof value === 'string' &&
    (builtinRouteIds.some((id) => id === value) ||
      (/^custom\.[a-z][a-z0-9-]{0,63}$/.test(value) && !/[\r\n]/.test(value)))
  )
    return value as UiRouteId;
  throw new Error('content.errors.preferences');
}

export function resolveRoute(
  requested: UiRouteId,
  routes: readonly UiRouteDescriptor[],
): UiRouteId {
  return routes.some((route) => route.id === requested) ? requested : 'home';
}

const fields = [
  'id',
  'entry',
  'title',
  'description',
  'navigation',
  'startupSelectable',
  'order',
  'icon',
];
/** UI sources interpret this identifier; metadata never depends on an icon library. */
function validIconIdentifier(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'string' || !value || value.length > 256 || !wellFormed(value)) return false;
  let length = 0;
  for (const character of value) {
    const scalar = character.codePointAt(0)!;
    if (++length > 128 || scalar < 32 || scalar === 127) return false;
  }
  return true;
}
/** A complete host publication is detached before it can replace active state. */
export function validateRouteRegistry(
  routes: readonly UiRouteDescriptor[],
): readonly UiRouteDescriptor[] {
  if (
    !Array.isArray(routes) ||
    routes.length < builtinRouteIds.length ||
    routes.length > builtinRouteIds.length + 32
  )
    throw new Error('Invalid route registry');
  const ids = new Set<UiRouteId>();
  const detached: UiRouteDescriptor[] = [];
  for (let index = 0; index < routes.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(routes, index);
    if (!entry || !Object.hasOwn(entry, 'value')) throw new Error('Invalid route registry');
    const route = entry.value as UiRouteDescriptor;
    if (
      !route ||
      typeof route !== 'object' ||
      Object.getPrototypeOf(route) !== Object.prototype ||
      Reflect.ownKeys(route).length !== fields.length ||
      fields.some(
        (key) =>
          !Object.hasOwn(route, key) ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(route, key)!, 'value'),
      )
    )
      throw new Error('Invalid route descriptor');
    const id = validateRouteId(route.id);
    if (
      ids.has(id) ||
      typeof route.entry !== 'string' ||
      !route.entry ||
      typeof route.title !== 'string' ||
      !route.title ||
      typeof route.description !== 'string' ||
      [route.entry, route.title, route.description].some((value) =>
        [...value].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ),
      ) ||
      typeof route.navigation !== 'boolean' ||
      typeof route.startupSelectable !== 'boolean' ||
      typeof route.order !== 'number' ||
      !Number.isFinite(route.order) ||
      !validIconIdentifier(route.icon)
    )
      throw new Error('Invalid route descriptor');
    ids.add(id);
    detached.push(
      Object.freeze({
        id,
        entry: route.entry,
        title: route.title,
        description: route.description,
        navigation: route.navigation,
        startupSelectable: route.startupSelectable,
        order: route.order,
        icon: route.icon,
      }),
    );
  }
  if (
    builtinRouteIds.some((id) => !ids.has(id)) ||
    detached.filter((route) => route.id.startsWith('custom.')).length > 32
  )
    throw new Error('Incomplete route registry');
  return Object.freeze(detached.sort((a, b) => a.order - b.order));
}
