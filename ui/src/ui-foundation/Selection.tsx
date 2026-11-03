import { foundationControl } from './environment';

export interface UiCheckboxProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}
export interface UiSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onValueChange: (value: number) => void;
  label: string;
  disabled?: boolean;
}
export const Checkbox = foundationControl(
  'control.checkbox',
  function DefaultCheckbox({ checked, onChange, label, disabled }: UiCheckboxProps) {
    return (
      <label className="ui-checkbox">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </label>
    );
  },
);
export const Slider = foundationControl(
  'control.slider',
  function DefaultSlider({ value, min, max, step, onValueChange, label, disabled }: UiSliderProps) {
    return (
      <input
        className="ui-slider"
        type="range"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.valueAsNumber)}
      />
    );
  },
);
export const Toggle = foundationControl(
  'control.toggle',
  function DefaultToggle({ checked, onChange, label, disabled }: UiCheckboxProps) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`toggle ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    );
  },
);
