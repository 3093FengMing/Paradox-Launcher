import { icons, type LucideIcon } from 'lucide-react';
export function routeIcon(name: string | null): LucideIcon | null {
  return name && Object.hasOwn(icons, name) ? icons[name as keyof typeof icons] : null;
}
