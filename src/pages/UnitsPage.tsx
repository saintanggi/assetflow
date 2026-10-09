import { CrudPage } from "../components/CrudPage";
import { Badge } from "../components/ui/badge";

export function UnitsPage() {
  return (
    <CrudPage
      title="Satuan"
      description="Kelola satuan barang persediaan."
      table="units"
      searchKeys={["kode", "nama"]}
      columns={[
        { key: "code", label: "Kode" },
        { key: "name", label: "Nama" },
        {
          key: "allow_decimal",
          label: "Desimal",
          render: (row) => (
            <Badge variant={Boolean(row.allow_decimal) ? "info" : "secondary"}>
              {Boolean(row.allow_decimal) ? "Ya" : "Tidak"}
            </Badge>
          ),
        },
      ]}
      fields={[
        { name: "code", label: "Kode", type: "text", required: true, placeholder: "cth. PCS" },
        { name: "name", label: "Nama", type: "text", required: true, placeholder: "cth. Pcs" },
        {
          name: "allow_decimal",
          label: "Izinkan desimal (mis. 2,5 Kg)",
          type: "checkbox",
        },
      ]}
    />
  );
}
