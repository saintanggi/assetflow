import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100",
  secondary: "bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200",
  destructive: "bg-rose-50 text-brand-700 ring-1 ring-inset ring-brand-200",
  outline: "bg-white text-ink-600 ring-1 ring-inset ring-ink-200",
  success: "bg-ok-50 text-ok-700 ring-1 ring-inset ring-ok-100",
  warning: "bg-warn-50 text-warn-700 ring-1 ring-inset ring-warn-100",
  info: "bg-info-50 text-info-700 ring-1 ring-inset ring-info-100",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}
