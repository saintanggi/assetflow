import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "./ui/card";
import { cn } from "../lib/utils";

interface StatCardProps {
  title: string;
  value: string;
  description?: string;
  icon?: LucideIcon;
  accent?: "neutral" | "navy" | "blue" | "green" | "yellow" | "red";
}

const accentBg: Record<NonNullable<StatCardProps["accent"]>, string> = {
  neutral: "bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200",
  navy: "bg-info-50 text-info-700 ring-1 ring-inset ring-info-100",
  blue: "bg-info-50 text-info-700 ring-1 ring-inset ring-info-100",
  green: "bg-ok-50 text-ok-700 ring-1 ring-inset ring-ok-100",
  yellow: "bg-warn-50 text-warn-700 ring-1 ring-inset ring-warn-100",
  red: "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100",
};

export function StatCard({ title, value, description, icon: Icon, accent = "neutral" }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-widest text-ink-500">{title}</p>
          <p className="tnum mt-1 font-display text-2xl font-bold text-ink-800">{value}</p>
          {description && <p className="truncate text-xs text-ink-500">{description}</p>}
        </div>
        {Icon && (
          <div className={cn("shrink-0 rounded-xl p-2.5", accentBg[accent])}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
