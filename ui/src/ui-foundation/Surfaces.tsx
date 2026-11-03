import type { ReactNode } from 'react';
import { foundationControl } from './environment';

export interface UiPanelProps {
  children: ReactNode;
  className?: string;
}
export interface UiBadgeProps {
  children: ReactNode;
  muted?: boolean;
}
export interface UiProgressProps {
  value: number | null;
  label: string;
}
export const Panel = foundationControl(
  'control.panel',
  function DefaultPanel({ children, className = '' }: UiPanelProps) {
    return <section className={`panel ${className}`}>{children}</section>;
  },
);
export const Badge = foundationControl(
  'control.badge',
  function DefaultBadge({ children, muted = false }: UiBadgeProps) {
    return <span className={`badge ${muted ? 'muted' : ''}`}>{children}</span>;
  },
);
export const Progress = foundationControl(
  'control.progress',
  function DefaultProgress({ value, label }: UiProgressProps) {
    return (
      <progress
        className="ui-progress"
        aria-label={label}
        value={value === null ? undefined : value}
        max={100}
      />
    );
  },
);
