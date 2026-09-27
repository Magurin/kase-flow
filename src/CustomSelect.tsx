import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

type Option = { value: number; label: string; disabled?: boolean };

/** Shared, keyboard-accessible dropdown. Options are portalled above dialogs. */
export function CustomSelect({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  options: Option[];
  disabled?: boolean;
}) {
  return (
    <Select.Root
      value={String(value)}
      onValueChange={(v) => onChange(Number(v))}
      disabled={disabled}
    >
      <Select.Trigger className="custom-select-trigger" aria-label={label}>
        <Select.Value />
        <Select.Icon className="custom-select-chevron">
          <ChevronDown size={18} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          aria-label={label}
          className="custom-select-content"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
        >
          <Select.ScrollUpButton className="custom-select-scroll">
            <ChevronUp size={16} />
          </Select.ScrollUpButton>
          <Select.Viewport className="custom-select-viewport">
            {options.map((option) => (
              <Select.Item
                className="custom-select-option"
                key={option.value}
                value={String(option.value)}
                disabled={option.disabled}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="custom-select-check">
                  <Check size={17} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="custom-select-scroll">
            <ChevronDown size={16} />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
