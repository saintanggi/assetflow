import { forwardRef } from "react";
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export interface TableDarkProps {
  /** Varian kaca gelap (halaman bertema gelap) — default tetap terang. */
  dark?: boolean;
}

export const Table = forwardRef<
  HTMLTableElement,
  HTMLAttributes<HTMLTableElement> & TableDarkProps
>(({ className, dark, ...props }, ref) => (
  <div
    className={cn(
      "w-full overflow-x-auto rounded-xl border",
      dark ? "border-white/15 bg-white/[0.07]" : "border-ink-200 bg-white"
    )}
  >
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  </div>
));
Table.displayName = "Table";

export function TableHeader({
  className,
  dark,
  ...props
}: HTMLAttributes<HTMLTableSectionElement> & TableDarkProps) {
  return (
    <thead className={cn(dark ? "bg-white/5" : "bg-ink-50", className)} {...props} />
  );
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableFooter({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot className={cn("border-t border-ink-200 bg-ink-50 font-medium", className)} {...props} />
  );
}

export function TableRow({
  className,
  dark,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & TableDarkProps) {
  return (
    <tr
      className={cn(
        "border-b transition-colors",
        dark
          ? "border-white/10 text-ink-100 hover:bg-white/5"
          : "border-ink-200 text-ink-700 hover:bg-brand-50/40",
        className
      )}
      {...props}
    />
  );
}

export function TableHead({
  className,
  dark,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & TableDarkProps) {
  return (
    <th
      className={cn(
        "h-11 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wide",
        dark ? "text-ink-300" : "text-ink-500",
        "whitespace-nowrap",
        className
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}

export function TableCaption({ className, ...props }: HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className={cn("mt-4 text-sm text-ink-500", className)} {...props} />;
}
