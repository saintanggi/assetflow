import { useState } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

interface ProofImageProps {
  /** URL publik foto bukti (null/undefined = belum ada foto). */
  url?: string | null;
  /** Keterangan untuk dialog (mis. nomor dokumen transaksi). */
  label?: string;
  /** thumb: tombol kecil untuk kolom tabel; large: pratinjau besar untuk dialog detail. */
  variant?: "thumb" | "large";
}

/**
 * Foto bukti surat jalan: thumbnail yang bisa diklik untuk melihat ukuran
 * penuh (lightbox) + tautan "Buka di tab baru". Dipakai di Log Transaksi
 * dan Riwayat Transaksi — menu mana pun yang menampilkan transaksi.
 */
export function ProofImage({ url, label, variant = "thumb" }: ProofImageProps) {
  const [open, setOpen] = useState(false);
  if (!url) {
    return variant === "large" ? (
      <p className="text-sm text-ink-300">Belum ada foto surat jalan.</p>
    ) : (
      <span className="text-ink-300">—</span>
    );
  }
  return (
    <>
      <button
        type="button"
        aria-label="Lihat foto surat jalan"
        onClick={(e) => {
          // Jangan ikut memicu klik baris (Log Transaksi membuka detail saat baris diklik).
          e.stopPropagation();
          setOpen(true);
        }}
        className={
          variant === "large"
            ? "block w-full overflow-hidden rounded-lg border border-white/15"
            : "inline-block overflow-hidden rounded border border-white/15"
        }
      >
        <img
          src={url}
          alt="Foto surat jalan"
          className={
            variant === "large"
              ? "max-h-72 w-full object-contain"
              : "h-10 w-14 object-cover"
          }
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogHeader>
          <DialogTitle>Foto Surat Jalan</DialogTitle>
          {label && <DialogDescription>{label}</DialogDescription>}
        </DialogHeader>
        <img
          src={url}
          alt="Foto surat jalan"
          className="max-h-[70vh] w-full rounded-lg object-contain"
        />
        <DialogFooter>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-ink-600 underline"
          >
            Buka di tab baru
          </a>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Tutup
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
