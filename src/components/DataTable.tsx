import { useState } from "react";
import type { ReactNode } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
} from "@tanstack/react-table";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { EmptyState } from "./EmptyState";

interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  loading?: boolean;
  searchPlaceholder?: string;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  /**
   * Bila diisi, di layar HP (< md) baris dirender sebagai kartu vertikal
   * (bukan tabel yang harus di-scroll ke samping). Tabel tetap dipakai di
   * layar ≥ md. Pencarian & paginasi tetap sama untuk kedua tampilan.
   */
  renderCard?: (row: TData) => ReactNode;
  /** Aksi tambahan di samping kolom pencarian (mis. tombol Scan Barcode). */
  searchActions?: ReactNode;
  /**
   * Pencarian terkontrol (opsional). Bila diisi, halaman induk memegang nilai
   * pencarian — mis. agar hasil scan barcode bisa langsung mengisi pencarian.
   */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  /**
   * Varian kaca gelap untuk halaman bertema gelap (mis. Stok Kondisi).
   * Default "dark" sejak 9 Nov 2026 — seluruh sistem kini bertema gelap,
   * jadi semua tabel tampil gelap kecuali halaman yang eksplisit memakai
   * variant="light" (mis. di dalam dialog/kartu terang).
   */
  variant?: "light" | "dark";
}

const PAGE_SIZES = [10, 25, 50, 100];

export function DataTable<TData>({
  columns,
  data,
  loading = false,
  searchPlaceholder = "Cari…",
  pageSize = 10,
  emptyTitle = "Tidak ada data",
  emptyDescription = "Belum ada data yang cocok dengan filter saat ini.",
  renderCard,
  searchActions,
  searchValue,
  onSearchChange,
  variant = "dark",
}: DataTableProps<TData>) {
  const dark = variant === "dark";
  const [internalFilter, setInternalFilter] = useState("");
  // Pencarian terkontrol bila induk menyediakan nilai + handler.
  const globalFilter = searchValue ?? internalFilter;
  const setGlobalFilter = onSearchChange ?? setInternalFilter;
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { globalFilter, sorting },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    // Filter toleran: abaikan kapital, spasi, dan underscore.
    // "ac indoor" cocok dengan "AC_Indoor_1.5_PK_Daikin".
    globalFilterFn: (row, _columnId, filterValue) => {
      const norm = (s: string) =>
        s.toLowerCase().replace(/[\s_]+/g, "");
      const q = norm(String(filterValue ?? ""));
      if (!q) return true;
      return row.getAllCells().some((cell) => {
        const v = cell.getValue();
        if (v == null) return false;
        return norm(String(v)).includes(q);
      });
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: { pagination: { pageSize } },
  });

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const totalRows = table.getFilteredRowModel().rows.length;
  const pageIndex = table.getState().pagination.pageIndex;
  const currentSize = table.getState().pagination.pageSize;
  const firstRow = totalRows === 0 ? 0 : pageIndex * currentSize + 1;
  const lastRow = Math.min(totalRows, (pageIndex + 1) * currentSize);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full flex-col gap-2 sm:max-w-md sm:flex-row">
          <div className="relative w-full">
            <Search
              className={
                dark
                  ? "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300"
                  : "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500"
              }
            />
            <Input
              placeholder={searchPlaceholder}
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className={
                dark
                  ? "border-white/15 bg-white/10 pl-9 text-white placeholder:text-ink-300"
                  : "pl-9"
              }
              aria-label={searchPlaceholder}
            />
          </div>
          {searchActions}
        </div>
        <div
          className={
            dark
              ? "flex items-center gap-2 text-sm text-ink-300"
              : "flex items-center gap-2 text-sm text-ink-500"
          }
        >
          <label htmlFor="dt-page-size" className="whitespace-nowrap">
            Baris per halaman
          </label>
          <select
            id="dt-page-size"
            value={currentSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            className={
              dark
                ? "h-9 rounded-lg border border-white/15 bg-white/10 px-2 text-sm text-white [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 focus-visible:border-brand-600"
                : "h-9 rounded-lg border border-ink-200 bg-white px-2 text-sm text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 focus-visible:border-brand-600"
            }
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s} className={dark ? "bg-ink-800 text-white" : undefined}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tampilan kartu untuk HP — hanya bila halaman menyediakan renderCard. */}
      {renderCard && (
        <div className="space-y-3 md:hidden">
          {table.getRowModel().rows.length === 0 ? (
            <div
              className={
                dark
                  ? "rounded-xl border border-white/15 bg-white/[0.07]"
                  : "rounded-xl border border-ink-200 bg-white"
              }
            >
              <EmptyState title={emptyTitle} description={emptyDescription} dark={dark} />
            </div>
          ) : (
            table.getRowModel().rows.map((row) => (
              <div
                key={row.id}
                className={
                  dark
                    ? "rounded-xl border border-white/15 bg-white/[0.07] p-4"
                    : "rounded-xl border border-ink-200 bg-white p-4 shadow-card"
                }
              >
                {renderCard(row.original)}
              </div>
            ))
          )}
        </div>
      )}

      {/* Tabel desktop — disembunyikan di HP bila ada tampilan kartu. */}
      <div className={renderCard ? "hidden md:block" : undefined}>
        <Table dark={dark}>
          <TableHeader dark={dark}>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} dark={dark} className={dark ? undefined : "hover:bg-ink-50"}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id} dark={dark}>
                    {h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow dark={dark} className="hover:bg-transparent">
                <TableCell colSpan={columns.length}>
                  <EmptyState title={emptyTitle} description={emptyDescription} dark={dark} />
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} dark={dark}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className={dark ? "text-sm text-ink-300" : "text-sm text-ink-500"}>
          {totalRows === 0 ? "Tidak ada data" : `Menampilkan ${firstRow}–${lastRow} dari ${totalRows} baris`}
        </span>
        <div className="flex items-center gap-2">
          <span className={dark ? "hidden text-sm text-ink-300 sm:inline" : "hidden text-sm text-ink-500 sm:inline"}>
            Halaman {table.getState().pagination.pageIndex + 1} dari {table.getPageCount() || 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            className={
              dark
                ? "border-white/20 bg-white/10 text-white hover:border-white/25 hover:bg-white/15 hover:text-white"
                : undefined
            }
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="h-4 w-4" /> Sebelumnya
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={
              dark
                ? "border-white/20 bg-white/10 text-white hover:border-white/25 hover:bg-white/15 hover:text-white"
                : undefined
            }
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Berikutnya <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
