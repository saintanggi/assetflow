import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

interface ProofImageProps {
  /** URL publik / path objek foto bukti (null/undefined = belum ada foto). */
  url?: string | null;
  /** Keterangan untuk dialog (mis. nomor dokumen transaksi). */
  label?: string;
  /** thumb: tombol kecil untuk kolom tabel; large: pratinjau besar untuk dialog detail. */
  variant?: "thumb" | "large";
}

// Cache signed URL selama 50 menit (expiry 60 menit) supaya tabel tidak memanggil storage berulang.
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

function extractSuratJalanPath(rawUrl: string): string | null {
  const m = rawUrl.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/surat-jalan\/([^?]+)/i);
  if (m) return decodeURIComponent(m[1]);
  if (!/^https?:\/\//i.test(rawUrl) && !rawUrl.startsWith("data:") && !rawUrl.startsWith("blob:")) {
    return rawUrl.replace(/^\/+/, "");
  }
  return null;
}

/**
 * Foto bukti surat jalan: mendukung bucket privat (Signed URL otomatis)
 * maupun URL publik lama secara seamless, lengkap dengan lightbox.
 */
export function ProofImage({ url, label, variant = "thumb" }: ProofImageProps) {
  const [open, setOpen] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(url ?? null);

  useEffect(() => {
    if (!url) {
      setResolvedUrl(null);
      return;
    }
    const objPath = extractSuratJalanPath(url);
    if (!objPath) {
      setResolvedUrl(url);
      return;
    }
    const cached = signedUrlCache.get(objPath);
    if (cached && cached.expiresAt > Date.now()) {
      setResolvedUrl(cached.url);
      return;
    }
    let cancelled = false;
    setResolvedUrl(url);
    (async () => {
      try {
        const { data, error } = await supabase.storage
          .from("surat-jalan")
          .createSignedUrl(objPath, 3600);
        if (!cancelled && !error && data?.signedUrl) {
          signedUrlCache.set(objPath, {
            url: data.signedUrl,
            expiresAt: Date.now() + 50 * 60 * 1000,
          });
          setResolvedUrl(data.signedUrl);
        }
      } catch {
        // Fallback otomatis ke URL asli bila createSignedUrl tidak tersedia.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const displayUrl = resolvedUrl ?? url ?? null;
  if (!displayUrl) {
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
          src={displayUrl}
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
          src={displayUrl}
          alt="Foto surat jalan"
          className="max-h-[70vh] w-full rounded-lg object-contain"
        />
        <DialogFooter>
          <a
            href={displayUrl}
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
