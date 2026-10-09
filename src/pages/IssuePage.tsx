import { PageHeader } from "../components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { TransactionForm } from "../features/transactions/TransactionForm";

export function IssuePage() {
  return (
    <div>
      <PageHeader
        title="Barang Keluar"
        description="Catat pengeluaran barang dari gudang"
      />
      <Card>
        <CardHeader>
          <CardTitle>Form Barang Keluar</CardTitle>
          <CardDescription>
            Stok yang dikeluarkan tidak boleh melebihi saldo yang tersedia —
            batas ini divalidasi oleh database.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TransactionForm
            type="out"
            typeLabel="Barang Keluar"
            needSource
            needDest={false}
            submitLabel="Posting Barang Keluar"
          />
        </CardContent>
      </Card>
    </div>
  );
}
