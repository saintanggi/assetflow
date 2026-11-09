import { forwardRef } from "react";
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
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    className,
    options,
    placeholder,
    onValueChange,
    onChange,
    value,
    ...props
  },
  ref
) {
  // Select gelap (tema kaca gelap) memakai teks putih — tanpa gaya eksplisit,
  // <option> ikut teks putih sementara popup native di sebagian browser tetap
  // putih, sehingga tulisannya tidak kelihatan. Beri opsi warna gelap eksplisit.
  const isDark = className?.includes("text-white") ?? false;
  const optionClassName = isDark ? "bg-ink-800 text-white" : undefined;
  return (
    <select
      ref={ref}
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
      {placeholder !== undefined && (
        <option value="" className={optionClassName}>
          {placeholder}
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value} className={optionClassName}>
          {o.label}
        </option>
      ))}
    </select>
  );
});
