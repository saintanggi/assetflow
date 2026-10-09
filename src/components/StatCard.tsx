import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "./ui/card";
import { cn } from "../lib/utils";

interface StatCardProps {
  title: string;
  value: string;
  description?: string;
  icon?: LucideIcon;
  accent?: "navy" | "blue" | "green" | "yellow" | "red";
}

const accentBg: Record<NonNullable<StatCardProps["accent"]>, string> = {
  navy: "bg-white/5 text-slate-300 ring-1 ring-white/10",
  blue: "bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/20",
  green: "bg-brand-400/10 text-brand-300 ring-1 ring-brand-400/20",
  yellow: "bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/20",
  red: "bg-rose-400/10 text-rose-300 ring-1 ring-rose-400/20",
};

export function StatCard({ title, value, description, icon: Icon, accent = "navy" }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">{title}</p>
          <p className="tnum mt-1 font-display text-2xl font-bold text-white">{value}</p>
          {description && <p className="text-xs text-slate-500">{description}</p>}
        </div>
        {Icon && (
          <div className={cn("rounded-xl p-2.5", accentBg[accent])}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
