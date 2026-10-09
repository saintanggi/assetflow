import { PageHeader } from "../components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { TransactionForm } from "../features/transactions/TransactionForm";

export function ReceivePage() {
  return (
    <div>
      <PageHeader
        title="Barang Masuk"
        description="Catat penerimaan barang ke gudang"
      />
      <Card>
        <CardHeader>
          <CardTitle>Form Barang Masuk</CardTitle>
          <CardDescription>
            Transaksi ini menambah stok di lokasi tujuan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TransactionForm
            type="in"
            typeLabel="Barang Masuk"
            needSource={false}
            needDest
            submitLabel="Posting Barang Masuk"
          />
        </CardContent>
      </Card>
    </div>
  );
}
