import { PageHeader } from "../components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { TransactionForm } from "../features/transactions/TransactionForm";

export function TransferPage() {
  return (
    <div>
      <PageHeader
        title="Transfer Stok"
        description="Pindahkan stok antar lokasi gudang"
      />
      <Card>
        <CardHeader>
          <CardTitle>Form Transfer Stok</CardTitle>
          <CardDescription>
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
      </Card>
    </div>
  );
}
