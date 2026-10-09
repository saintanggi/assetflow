import { CrudPage } from "../components/CrudPage";

export function SuppliersPage() {
  return (
    <CrudPage
      title="Supplier"
      description="Kelola data pemasok barang."
      table="suppliers"
      searchKeys={["kode", "nama"]}
      columns={[
        { key: "code", label: "Kode" },
        { key: "name", label: "Nama" },
        {
          key: "contact",
          label: "Kontak",
          render: (row) => String(row.contact ?? "—"),
        },
        {
          key: "phone",
          label: "Telepon",
          render: (row) => String(row.phone ?? "—"),
        },
      ]}
      fields={[
        { name: "code", label: "Kode", type: "text", required: true, placeholder: "cth. SUP-001" },
        { name: "name", label: "Nama", type: "text", required: true, placeholder: "cth. PT Maju Jaya" },
        { name: "contact", label: "Kontak", type: "text", placeholder: "Nama narahubung" },
        { name: "phone", label: "Telepon", type: "text", placeholder: "cth. 0812…" },
        { name: "address", label: "Alamat", type: "textarea", placeholder: "Alamat supplier (opsional)" },
      ]}
    />
  );
}
