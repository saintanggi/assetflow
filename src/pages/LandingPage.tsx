import { Link } from "react-router-dom";
import {
  Boxes,
  ArrowLeftRight,
  QrCode,
  BarChart3,
  ArrowRight,
  ClipboardList,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: Boxes,
    title: "Aset Tetap",
    description:
      "Kelola seluruh aset tetap perusahaan — dari pembelian, penempatan, hingga kondisi dan status — dalam satu tempat yang rapi.",
  },
  {
    icon: ArrowLeftRight,
    title: "Persediaan & Transaksi",
    description:
      "Catat barang masuk, keluar, transfer, dan stock opname dengan saldo real-time per gudang dan lokasi.",
  },
  {
    icon: QrCode,
    title: "QR / Barcode",
    description:
      "Setiap aset punya kode QR unik yang tertaut ke halaman publik, memudahkan identifikasi dan inventarisasi di lapangan.",
  },
  {
    icon: BarChart3,
    title: "Laporan & Audit",
    description:
      "Pantau pergerakan aset dan stok lewat laporan visual, plus jejak audit lengkap untuk setiap perubahan data.",
  },
];

export function LandingPage() {
  return (
    <div className="bg-navy-950 text-white">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(52,103,163,0.35),transparent_60%)]"
        />
        <div className="relative mx-auto flex max-w-7xl flex-col items-center px-4 py-20 text-center sm:py-28">
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
            <ClipboardList className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            AssetFlow
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-300 sm:text-lg">
            Sistem informasi manajemen aset tetap dan persediaan gudang — pencatatan
            akurat, pelacakan real-time, dan transparansi penuh untuk operasional
            perusahaan Anda.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/publik"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-white px-6 text-base font-medium text-navy-900 shadow-sm transition-colors hover:bg-slate-100"
            >
              Lihat Katalog Publik
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/login"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-white/30 bg-transparent px-6 text-base font-medium text-white transition-colors hover:bg-white/10"
            >
              Masuk
            </Link>
          </div>
        </div>
      </section>

      {/* Fitur */}
      <section className="relative border-t border-white/10 bg-navy-900/60">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:py-20">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">
            Semua kebutuhan aset dalam satu platform
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-slate-400 sm:text-base">
            Dirancang untuk tim operasional, gudang, dan manajemen — mudah dipakai,
            aman, dan dapat diaudit.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur transition-colors hover:border-white/25 hover:bg-white/10"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/20 text-brand-300">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA bawah */}
      <section className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center px-4 py-14 text-center">
          <h2 className="text-xl font-bold sm:text-2xl">
            Jelajahi katalog aset yang dipublikasikan
          </h2>
          <p className="mt-2 max-w-md text-sm text-slate-400">
            Katalog publik dapat diakses siapa pun tanpa perlu masuk — cukup pindai
            QR code pada aset.
          </p>
          <Link
            to="/publik"
            className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-white px-6 text-base font-medium text-navy-900 shadow-sm transition-colors hover:bg-slate-100"
          >
            Buka Katalog Publik
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
