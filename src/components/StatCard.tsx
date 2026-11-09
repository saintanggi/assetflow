import type { LucideIcon } from "lucide-react";
import { CardContent } from "./ui/card";
import { cn } from "../lib/utils";

interface StatCardProps {
  title: string;
  value: string;
  description?: string;
  icon?: LucideIcon;
  accent?: "neutral" | "navy" | "blue" | "green" | "yellow" | "red";
}

/** Aksen ikon — versi kaca gelap (dipakai di dashboard super admin yang bertema gelap). */
const accentBg: Record<NonNullable<StatCardProps["accent"]>, string> = {
  neutral: "bg-white/10 text-ink-100 ring-1 ring-inset ring-white/15",
  navy: "bg-info-500/15 text-info-100 ring-1 ring-inset ring-info-500/25",
  blue: "bg-info-500/15 text-info-100 ring-1 ring-inset ring-info-500/25",
  green: "bg-ok-500/15 text-ok-100 ring-1 ring-inset ring-ok-500/25",
  yellow: "bg-warn-500/15 text-warn-100 ring-1 ring-inset ring-warn-500/25",
  red: "bg-brand-500/15 text-brand-100 ring-1 ring-inset ring-brand-500/25",
};

export function StatCard({ title, value, description, icon: Icon, accent = "neutral" }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/[0.07] shadow-[0_8px_32px_rgba(2,6,23,0.35)] backdrop-blur-xl transition-all duration-300 hover:border-white/25 hover:bg-white/[0.09]">
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-widest text-ink-300">{title}</p>
          <p className="tnum mt-1 font-display text-2xl font-bold text-white">{value}</p>
          {description && <p className="truncate text-xs text-ink-300">{description}</p>}
        </div>
        {Icon && (
          <div className={cn("shrink-0 rounded-xl p-2.5", accentBg[accent])}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </CardContent>
    </div>
  );
}
