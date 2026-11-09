import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { TransactionForm } from "../features/transactions/TransactionForm";

/** Permukaan kaca gelap — sama seperti dashboard & Stok Kondisi. */
function GlassCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/15 bg-white/[0.07] shadow-[0_8px_32px_rgba(2,6,23,0.35)] backdrop-blur-xl transition-all duration-300 hover:border-white/25 hover:bg-white/[0.09]",
        className
      )}
      {...props}
    />
  );
}

export function TransferPage() {
  return (
    <div>
      <PageHeader
        title="Transfer Stok"
        description="Pindahkan stok antar lokasi gudang"
      />
      <GlassCard>
        <CardHeader>
          <CardTitle className="text-white">Form Transfer Stok</CardTitle>
          <CardDescription className="text-ink-300">
            Transaksi ini bersifat atomik: stok dikurangi di lokasi asal dan
            ditambahkan di lokasi tujuan dalam satu proses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TransactionForm
            type="transfer"
            typeLabel="Transfer Stok"
            needSource
            needDest
            submitLabel="Posting Transfer"
          />
        </CardContent>
      </GlassCard>
    </div>
  );
}
