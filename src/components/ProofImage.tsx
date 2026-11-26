import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import { parseProofUrls } from "../lib/proofUrls";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

interface ProofImageProps {
  /** URL publik / path objek foto bukti (1 URL atau JSON array URL; null/undefined = belum ada foto). */
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
 * Foto bukti surat jalan: mendukung 1 atau banyak foto sekaligus, bucket privat
 * (Signed URL otomatis) maupun URL publik lama secara seamless, lengkap dengan lightbox.
 */
export function ProofImage({ url, label, variant = "thumb" }: ProofImageProps) {
  const rawUrls = useMemo(() => parseProofUrls(url), [url]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [resolvedUrls, setResolvedUrls] = useState<string[]>(rawUrls);

  useEffect(() => {
    if (rawUrls.length === 0) {
      setResolvedUrls([]);
      return;
    }

    const initial = rawUrls.map((raw) => {
      const objPath = extractSuratJalanPath(raw);
      if (!objPath) return raw;
      const cached = signedUrlCache.get(objPath);
      if (cached && cached.expiresAt > Date.now()) return cached.url;
      return raw;
    });
    setResolvedUrls(initial);

    let cancelled = false;
    (async () => {
      const next = await Promise.all(
        rawUrls.map(async (raw) => {
          const objPath = extractSuratJalanPath(raw);
          if (!objPath) return raw;
          const cached = signedUrlCache.get(objPath);
          if (cached && cached.expiresAt > Date.now()) return cached.url;
          try {
            const { data, error } = await supabase.storage
              .from("surat-jalan")
              .createSignedUrl(objPath, 3600);
            if (!error && data?.signedUrl) {
              signedUrlCache.set(objPath, {
                url: data.signedUrl,
                expiresAt: Date.now() + 50 * 60 * 1000,
              });
              return data.signedUrl;
            }
          } catch {
            // Fallback otomatis ke URL asli bila createSignedUrl tidak tersedia.
          }
          return raw;
        })
      );
      if (!cancelled) setResolvedUrls(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [rawUrls]);

  const displayUrls = resolvedUrls.length === rawUrls.length ? resolvedUrls : rawUrls;
  if (displayUrls.length === 0) {
    return variant === "large" ? (
      <p className="text-sm text-ink-300">Belum ada foto surat jalan.</p>
    ) : (
      <span className="text-ink-300">—</span>
    );
  }

  const safeIndex = Math.min(activeIndex, displayUrls.length - 1);
  const currentUrl = displayUrls[safeIndex];
  const hasMultiple = displayUrls.length > 1;

  const openAt = (idx: number, e: React.MouseEvent) => {
    // Jangan ikut memicu klik baris (Log Transaksi membuka detail saat baris diklik).
    e.stopPropagation();
    setActiveIndex(idx);
    setOpen(true);
  };

  return (
    <>
      {variant === "thumb" ? (
        <button
          type="button"
          aria-label={
            hasMultiple
              ? `Lihat ${displayUrls.length} foto surat jalan`
              : "Lihat foto surat jalan"
          }
          onClick={(e) => openAt(0, e)}
          className="relative inline-block overflow-hidden rounded border border-white/15"
        >
          <img
            src={displayUrls[0]}
            alt="Foto surat jalan"
            className="h-10 w-14 object-cover"
          />
          {hasMultiple && (
            <span className="absolute bottom-0.5 right-0.5 rounded bg-ink-900/85 px-1 text-[10px] font-semibold text-white">
              +{displayUrls.length - 1}
            </span>
          )}
        </button>
      ) : hasMultiple ? (
        <div className="space-y-2">
          <p className="text-xs text-ink-500">{displayUrls.length} foto surat jalan terlampir</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {displayUrls.map((src, idx) => (
              <button
                key={`${rawUrls[idx] ?? src}-${idx}`}
                type="button"
                aria-label={`Lihat foto surat jalan ${idx + 1}`}
                onClick={(e) => openAt(idx, e)}
                className="group relative overflow-hidden rounded-lg border border-ink-200 bg-ink-50"
              >
                <img
                  src={src}
                  alt={`Foto surat jalan ${idx + 1}`}
                  className="h-32 w-full object-cover transition group-hover:opacity-90"
                />
                <span className="absolute bottom-1 right-1 rounded bg-ink-900/80 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  Foto {idx + 1}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button
          type="button"
          aria-label="Lihat foto surat jalan"
          onClick={(e) => openAt(0, e)}
          className="block w-full overflow-hidden rounded-lg border border-ink-200 bg-ink-50"
        >
          <img
            src={displayUrls[0]}
            alt="Foto surat jalan"
            className="max-h-72 w-full object-contain"
          />
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogHeader>
          <DialogTitle>Foto Surat Jalan</DialogTitle>
          {(label || hasMultiple) && (
            <DialogDescription>
              {[label, hasMultiple ? `Foto ${safeIndex + 1} dari ${displayUrls.length}` : null]
                .filter(Boolean)
                .join(" — ")}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="relative">
          <img
            src={currentUrl}
            alt={`Foto surat jalan ${safeIndex + 1}`}
            className="max-h-[65vh] w-full rounded-lg object-contain"
          />
          {hasMultiple && (
            <>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Foto sebelumnya"
                onClick={() =>
                  setActiveIndex((i) => (i - 1 + displayUrls.length) % displayUrls.length)
                }
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/90"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Foto berikutnya"
                onClick={() => setActiveIndex((i) => (i + 1) % displayUrls.length)}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/90"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
        {hasMultiple && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {displayUrls.map((src, idx) => (
              <button
                key={`thumb-${rawUrls[idx] ?? src}-${idx}`}
                type="button"
                aria-label={`Pilih foto ${idx + 1}`}
                onClick={() => setActiveIndex(idx)}
                className={`shrink-0 overflow-hidden rounded border-2 ${
                  idx === safeIndex ? "border-brand-600" : "border-transparent opacity-70 hover:opacity-100"
                }`}
              >
                <img
                  src={src}
                  alt={`Thumbnail ${idx + 1}`}
                  className="h-12 w-16 object-cover"
                />
              </button>
            ))}
          </div>
        )}
        <DialogFooter>
          <a
            href={currentUrl}
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
