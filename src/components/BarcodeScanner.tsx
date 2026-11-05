import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import type { CameraDevice } from "html5-qrcode";
import { Camera, CameraOff, ScanLine } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

const FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.CODE_128,
];

interface BarcodeScannerProps {
  /** Modal terbuka atau tidak. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dipanggil sekali saat sebuah kode berhasil terbaca. */
  onScan: (code: string) => void;
  title?: string;
  description?: string;
}

/**
 * Modal scan barcode/QR pakai kamera HP.
 *
 * Dipakai di panel Kirim Barang (isi barcode baris kosong pertama) dan di
 * Master Barang (isi kolom pencarian). Kamera belakang dipilih otomatis bila
 * ada. Scanner berhenti sendiri saat modal ditutup atau kode terbaca.
 */
export function BarcodeScanner({
  open,
  onOpenChange,
  onScan,
  title = "Scan Barcode",
  description = "Arahkan kamera ke barcode / QR code. Hasil scan langsung masuk ke kolom.",
}: BarcodeScannerProps) {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const activeRef = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const stop = useCallback(async () => {
    const s = scannerRef.current;
    if (s && activeRef.current) {
      try {
        await s.stop();
      } catch {
        // abaikan — scanner mungkin sudah berhenti
      }
      activeRef.current = false;
    }
  }, []);

  // Daftar kamera saat modal dibuka.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setCameras([]);
    setCameraId("");
    Html5Qrcode.getCameras()
      .then((list) => {
        if (cancelled) return;
        setCameras(list);
        // Utamakan kamera belakang di HP.
        const back = list.find((c) => /back|rear|belakang/i.test(c.label));
        const picked = back ?? list[list.length - 1] ?? list[0];
        if (picked) setCameraId(picked.id);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Tidak dapat mengakses daftar kamera."
        );
      });
    return () => {
      cancelled = true;
      void stop();
    };
  }, [open, stop]);

  // Mulai kamera otomatis begitu kamera dipilih.
  useEffect(() => {
    if (!open || !cameraId) return;
    let cancelled = false;
    setStarting(true);
    void (async () => {
      try {
        await stop();
        if (cancelled) return;
        if (!scannerRef.current) {
          scannerRef.current = new Html5Qrcode("barcode-scanner-reader", {
            formatsToSupport: FORMATS,
            verbose: false,
          });
        }
        await scannerRef.current.start(
          cameraId,
          { fps: 10, qrbox: { width: 280, height: 160 } },
          (decodedText) => {
            const code = decodedText.trim();
            if (!code) return;
            void stop().then(() => {
              onScanRef.current(code);
              onOpenChange(false);
            });
          },
          () => {
            // frame tanpa kode — abaikan diam-diam
          }
        );
        if (cancelled) {
          await stop();
          return;
        }
        activeRef.current = true;
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Gagal memulai kamera."
          );
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();
    return () => {
      cancelled = true;
      void stop();
    };
  }, [open, cameraId, stop, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {error && (
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-600">
            {error} Pastikan izin kamera diberikan dan halaman diakses via HTTPS.
          </div>
        )}
        {cameras.length > 1 && (
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 shrink-0 text-ink-500" />
            <select
              value={cameraId}
              onChange={(e) => setCameraId(e.target.value)}
              className="h-11 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30"
              aria-label="Pilih kamera"
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label || `Kamera ${c.id.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </div>
        )}
        <div
          id="barcode-scanner-reader"
          className="overflow-hidden rounded-lg border border-ink-200 bg-ink-950"
          style={{ minHeight: open ? 280 : 0 }}
        />
        {starting && (
          <p className="flex items-center gap-2 text-sm text-ink-500">
            <ScanLine className="h-4 w-4 animate-pulse" /> Menyalakan kamera…
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              void stop().then(() => onOpenChange(false));
            }}
          >
            <CameraOff className="mr-2 h-4 w-4" /> Tutup Kamera
          </Button>
        </div>
        <p className="text-xs text-ink-500">
          Kalau kamera tidak bisa dibuka, tutup modal ini dan ketik barcode secara manual.
        </p>
      </div>
    </Dialog>
  );
}
