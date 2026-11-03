export function intrinsicTag(type: unknown): string | undefined {
  if (typeof type === 'string') return type;
  if (typeof type === 'function' && 'uiTag' in type && typeof type.uiTag === 'string')
    return type.uiTag;
  return undefined;
}
