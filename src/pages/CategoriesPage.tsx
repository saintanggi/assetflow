import { CrudPage } from "../components/CrudPage";
import { Badge } from "../components/ui/badge";

function statusBadge(row: Record<string, unknown>) {
  const aktif = Boolean(row.is_active);
  return (
    <Badge variant={aktif ? "success" : "secondary"}>
      {aktif ? "Aktif" : "Nonaktif"}
    </Badge>
  );
}

export function CategoriesPage() {
  return (
    <CrudPage
      title="Kategori Aset"
      description="Kelola kategori untuk aset tetap dan persediaan."
      table="asset_categories"
      searchKeys={["kode", "nama"]}
      allowToggleActive
      columns={[
        { key: "code", label: "Kode" },
        { key: "name", label: "Nama" },
        {
          key: "description",
          label: "Deskripsi",
          render: (row) => String(row.description ?? "—"),
        },
        { key: "is_active", label: "Status", render: statusBadge },
      ]}
      fields={[
        { name: "code", label: "Kode", type: "text", required: true, placeholder: "cth. ELK" },
        { name: "name", label: "Nama", type: "text", required: true, placeholder: "cth. Elektronik" },
        { name: "description", label: "Deskripsi", type: "textarea", placeholder: "Keterangan kategori (opsional)" },
        { name: "is_active", label: "Aktif", type: "checkbox" },
      ]}
    />
  );
}
