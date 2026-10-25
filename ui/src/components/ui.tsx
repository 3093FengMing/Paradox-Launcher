import type { ReactNode } from 'react';

interface PanelProps {
  children: ReactNode;
  className?: string;
}
interface BadgeProps {
  children: ReactNode;
  muted?: boolean;
}
interface FieldProps {
  label: string;
  description?: string;
  children: ReactNode;
}
interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}

export function Panel({ children, className = '' }: PanelProps) {
  return <section className={`panel ${className}`}>{children}</section>;
}

export function Badge({ children, muted = false }: BadgeProps) {
  return <span className={`badge ${muted ? 'muted' : ''}`}>{children}</span>;
}

export function Field({ label, description, children }: FieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      {description && <small>{description}</small>}
      {children}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
