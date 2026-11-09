import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Varian kaca gelap — dipakai di dalam tabel/panel bertema gelap. */
  dark?: boolean;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  dark = false,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div
        className={
          dark
            ? "rounded-full bg-white/[0.07] p-4 ring-1 ring-inset ring-white/15"
            : "rounded-full bg-ink-100 p-4 ring-1 ring-inset ring-ink-200"
        }
      >
        <Icon className={dark ? "h-7 w-7 text-ink-300" : "h-7 w-7 text-ink-500"} />
      </div>
      <h3
        className={
          dark
            ? "mt-2 font-display text-base font-semibold text-white"
            : "mt-2 font-display text-base font-semibold text-ink-800"
        }
      >
        {title}
      </h3>
      {description && (
        <p className={dark ? "max-w-sm text-sm text-ink-300" : "max-w-sm text-sm text-ink-500"}>
          {description}
        </p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
