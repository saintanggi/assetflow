import type { SelectHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  placeholder?: string;
  onValueChange?: (value: string) => void;
}

/** Select native yang di-style — andal & mudah diuji. */
export function Select({
  className,
  options,
  placeholder,
  onValueChange,
  onChange,
  value,
  ...props
}: SelectProps) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => {
        onChange?.(e);
        onValueChange?.(e.target.value);
      }}
      className={cn(
        "flex h-10 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 focus-visible:border-brand-600",
        "disabled:cursor-not-allowed disabled:bg-ink-50 disabled:opacity-60",
        !value && "text-ink-500",
        className
      )}
      {...props}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
