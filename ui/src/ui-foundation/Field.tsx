import { Children, cloneElement, createContext, isValidElement, useContext, useId } from 'react';
import type { ReactNode } from 'react';
import { intrinsicTag } from '../customization/intrinsics';
import { foundationControl } from './environment';

export interface UiFieldProps {
  label: string;
  description?: string;
  children: ReactNode;
}
interface FieldAssociation {
  labelId: string;
  descriptionId?: string;
}
const FieldContext = createContext<FieldAssociation | null>(null);
// eslint-disable-next-line react-refresh/only-export-components
export function useFieldAssociation(): FieldAssociation | null {
  return useContext(FieldContext);
}

function DefaultField({ label, description, children }: UiFieldProps): React.JSX.Element {
  const labelId = useId();
  const descriptionId = description ? `${labelId}-description` : undefined;
  const controls = Children.map(children, (child) => {
    if (
      !isValidElement<{ 'aria-labelledby'?: string; 'aria-describedby'?: string }>(child) ||
      !['input', 'select', 'textarea'].includes(intrinsicTag(child.type) ?? '')
    )
      return child;
    return cloneElement(child, {
      'aria-labelledby': child.props['aria-labelledby'] ?? labelId,
      'aria-describedby': child.props['aria-describedby'] ?? descriptionId,
    });
  });
  return (
    <FieldContext.Provider value={{ labelId, descriptionId }}>
      <label className="field">
        <span id={labelId}>{label}</span>
        {description && <small id={descriptionId}>{description}</small>}
        {controls}
      </label>
    </FieldContext.Provider>
  );
}
export const Field = foundationControl('control.field', DefaultField);
