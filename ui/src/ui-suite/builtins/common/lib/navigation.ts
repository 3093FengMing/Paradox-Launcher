import * as lucide from 'lucide-react';

const concreteIcons = new Set<unknown>(Object.values(lucide.icons));
/** This suite owns icon rendering; unknown identifiers safely render without an icon. */
export function routeIcon(name: string | null): lucide.LucideIcon | null {
  if (!name || !Object.hasOwn(lucide, name)) return null;
  const icon = lucide[name as keyof typeof lucide];
  return concreteIcons.has(icon) ? (icon as unknown as lucide.LucideIcon) : null;
}
