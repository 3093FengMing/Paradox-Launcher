/** Suite copies keep their shell source even when their instance and manifest IDs change. */
export function hasImmersiveLayoutSource(
  bundle: { readonly manifest: { readonly views: Readonly<Record<string, string>> } } | null | undefined,
): boolean {
  return bundle?.manifest.views['layout.shell'] === 'immersive/Shell.tsx';
}
