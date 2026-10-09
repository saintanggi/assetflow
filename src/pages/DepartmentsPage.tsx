import { CrudPage } from "../components/CrudPage";

export function DepartmentsPage() {
  return (
    <CrudPage
      title="Departemen"
      description="Kelola departemen pengguna aset."
      table="departments"
      searchKeys={["kode", "nama"]}
      columns={[
        { key: "code", label: "Kode" },
        { key: "name", label: "Nama" },
      ]}
      fields={[
        { name: "code", label: "Kode", type: "text", required: true, placeholder: "cth. IT" },
        {
          name: "name",
          label: "Nama",
          type: "text",
          required: true,
          placeholder: "cth. Teknologi Informasi",
        },
      ]}
    />
  );
}
