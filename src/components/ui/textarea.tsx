import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800",
        "placeholder:text-ink-400",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 focus-visible:border-brand-600",
        "disabled:cursor-not-allowed disabled:bg-ink-50 disabled:opacity-60",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
