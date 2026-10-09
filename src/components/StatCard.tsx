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
  navy: "bg-navy-100 text-navy-700",
  blue: "bg-blue-100 text-blue-700",
  green: "bg-green-100 text-green-700",
  yellow: "bg-yellow-100 text-yellow-700",
  red: "bg-red-100 text-red-700",
};

export function StatCard({ title, value, description, icon: Icon, accent = "navy" }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="text-2xl font-bold text-navy-900">{value}</p>
          {description && <p className="text-xs text-slate-400">{description}</p>}
        </div>
        {Icon && (
          <div className={cn("rounded-lg p-2.5", accentBg[accent])}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
