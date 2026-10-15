import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type Variant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type Size = "default" | "sm" | "lg" | "icon";

const variantClasses: Record<Variant, string> = {
  default:
    "bg-brand-600 text-white font-semibold shadow-soft hover:bg-brand-700 active:bg-brand-800",
  destructive: "bg-brand-600 text-white font-semibold shadow-soft hover:bg-brand-700 active:bg-brand-800",
  outline: "border border-ink-200 bg-white text-ink-800 hover:bg-ink-50 hover:border-ink-300",
  secondary: "bg-ink-100 text-ink-800 hover:bg-ink-200",
  ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-800",
  link: "text-brand-600 underline-offset-4 hover:underline",
};

const sizeClasses: Record<Size, string> = {
  default: "h-10 px-4 py-2",
  sm: "h-8 rounded-md px-3 text-xs",
  lg: "h-11 rounded-md px-6 text-base",
  icon: "h-10 w-10",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        "disabled:pointer-events-none disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
