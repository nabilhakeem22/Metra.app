'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface SelectControlOption {
  value: string;
  label: string;
}

/**
 * A glass Select as ONE control, so a FormField can label and describe it: the
 * id and the aria attributes FormField clones in land on the trigger, which is
 * the element a screen reader and a label actually reach.
 */
export function SelectControl({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  ...trigger
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectControlOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-describedby'?: string;
  'aria-required'?: boolean | 'true' | 'false';
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger {...trigger}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
