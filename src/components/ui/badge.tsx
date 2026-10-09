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
  default: "bg-white/10 text-slate-200 border border-white/10",
  secondary: "bg-white/5 text-slate-400 border border-white/10",
  destructive: "bg-rose-400/10 text-rose-300 border border-rose-400/20",
  outline: "border border-white/15 text-slate-300",
  success: "bg-brand-400/10 text-brand-300 border border-brand-400/20",
  warning: "bg-amber-400/10 text-amber-300 border border-amber-400/20",
  info: "bg-sky-400/10 text-sky-300 border border-sky-400/20",
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
