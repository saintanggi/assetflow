import { useCallback, useEffect, useRef, useState } from "react";
import type { HTMLAttributes } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import type { CameraDevice } from "html5-qrcode";
import { Camera, CameraOff, Search, Copy, Check, RotateCcw, ExternalLink } from "lucide-react";
import { supabase } from "../lib/supabase";
import { cn } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { toast } from "sonner";

/**
 * CATATAN KEAMANAN: halaman ini TIDAK mengubah stok atau data apa pun.
 * Scanner hanya menampilkan hasil konfirmasi + tautan. Validasi izin
 * (mis. assets.view / inventory.view) dan status dilakukan di halaman tujuan.
 */

/** Permukaan kaca gelap — sama seperti dashboard & Stok Kondisi. */
function GlassCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/15 bg-white/[0.07] shadow-[0_8px_32px_rgba(2,6,23,0.35)] backdrop-blur-xl transition-all duration-300 hover:border-white/25 hover:bg-white/[0.09]",
        className
      )}
      {...props}
    />
  );
}

/** Tombol outline di atas kaca gelap (ganti bawaan putih). */
const DARK_OUTLINE_BTN =
  "border-white/20 bg-white/10 text-white hover:border-white/25 hover:bg-white/15 hover:text-white";

type ScanResult =
  | { kind: "public"; url: string; publicCode: string }
  | { kind: "asset"; id: string; asset_code: string; name: string }
  | { kind: "item"; id: string; sku: string; name: string }
  | { kind: "raw"; text: string };

const FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.CODE_128,
];

export function ScannerPage() {
  const navigate = useNavigate();
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [scanning, setScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [manual, setManual] = useState("");
  const [copied, setCopied] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scanningRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Html5Qrcode.getCameras()
      .then((list) => {
        if (cancelled) return;
        setCameras(list);
        if (list.length > 0) setCameraId(list[0].id);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCameraError(
          err instanceof Error ? err.message : "Tidak dapat mengakses daftar kamera."
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stopScanner = useCallback(async () => {
    const s = scannerRef.current;
    if (s && scanningRef.current) {
      try {
        await s.stop();
      } catch {
        // abaikan — scanner mungkin sudah berhenti
      }
      scanningRef.current = false;
      setScanning(false);
    }
  }, []);

  // Bersihkan scanner saat halaman ditutup / unmount.
  useEffect(() => {
    const s = scannerRef.current;
    return () => {
      if (s && scanningRef.current) {
        void s.stop().catch(() => undefined);
      }
    };
  }, []);

  const resolveText = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t) return;
    setResolving(true);
    setCopied(false);

    // (a) URL publik aset — mis. https://app/publik/aset/abc-123
    const pubMatch = t.match(/\/publik\/aset\/([\w-]+)\/?$/);
    if (pubMatch) {
      setResult({ kind: "public", url: t, publicCode: pubMatch[1] });
      setResolving(false);
      return;
    }

    // Resolver hanya mengembalikan target sesuai izin assets.view / inventory.view.
    if (/^\d{12}$/.test(t)) {
      const { data } = await supabase.rpc("resolve_qr_label", { p_code: t });
      const serial = (data as { kind: "asset" | "item"; id: string; code: string; name: string }[] | null)?.[0];
      if (serial) {
        setResult(serial.kind === "asset"
          ? { kind: "asset", id: serial.id, asset_code: serial.code, name: serial.name }
          : { kind: "item", id: serial.id, sku: serial.code, name: serial.name });
        setResolving(false);
        return;
      }
    }

    // (b) Cari di DB: aset by asset_code / public_code
    const { data: asset } = await supabase
      .from("assets")
      .select("id, asset_code, name")
      .eq("asset_code", t)
      .maybeSingle();
    if (asset) {
      const a = asset as { id: string; asset_code: string; name: string };
      setResult({ kind: "asset", id: a.id, asset_code: a.asset_code, name: a.name });
      setResolving(false);
      return;
    }
    const { data: assetByPublic } = await supabase
      .from("assets")
      .select("id, asset_code, name")
      .eq("public_code", t)
      .maybeSingle();
    if (assetByPublic) {
      const a = assetByPublic as { id: string; asset_code: string; name: string };
      setResult({ kind: "asset", id: a.id, asset_code: a.asset_code, name: a.name });
      setResolving(false);
      return;
    }

    // (b) Cari di DB: barang by sku / barcode
    const { data: itemBySku } = await supabase
      .from("inventory_items")
      .select("id, sku, name")
      .eq("sku", t)
      .maybeSingle();
    if (itemBySku) {
      const it = itemBySku as { id: string; sku: string; name: string };
      setResult({ kind: "item", id: it.id, sku: it.sku, name: it.name });
      setResolving(false);
      return;
    }
    const { data: itemByBarcode } = await supabase
      .from("inventory_items")
      .select("id, sku, name")
      .eq("barcode", t)
      .maybeSingle();
    if (itemByBarcode) {
      const it = itemByBarcode as { id: string; sku: string; name: string };
      setResult({ kind: "item", id: it.id, sku: it.sku, name: it.name });
      setResolving(false);
      return;
    }

    // (c) Tidak cocok — tampilkan teks mentah.
    setResult({ kind: "raw", text: t });
    setResolving(false);
  }, []);

  const startScanner = async () => {
    if (!cameraId) {
      toast.error("Pilih kamera terlebih dahulu");
      return;
    }
    setStarting(true);
    setResult(null);
    try {
      if (!scannerRef.current) {
        // formatsToSupport didaftarkan di konfigurasi konstruktor (bukan config start).
        scannerRef.current = new Html5Qrcode("qr-reader", {
          formatsToSupport: FORMATS,
          verbose: false,
        });
      }
      const scanner = scannerRef.current;
      await scanner.start(
        cameraId,
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          // Sukses: hentikan scanner lalu tampilkan konfirmasi.
          void stopScanner().then(() => {
            void resolveText(decodedText);
          });
        },
        () => {
          // frame tanpa kode — abaikan diam-diam
        }
      );
      scanningRef.current = true;
      setScanning(true);
    } catch (err) {
      toast.error("Gagal memulai kamera", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setStarting(false);
    }
  };

  const handleManualSearch = () => {
    if (!manual.trim()) {
      toast.error("Masukkan kode atau teks hasil pindaian");
      return;
    }
    setResult(null);
    void resolveText(manual);
  };

  const copyRaw = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Teks disalin");
    } catch {
      toast.error("Gagal menyalin — salin manual dari kolom di bawah");
    }
  };

  return (
    <div>
      <PageHeader
        title="Pindai Kode"
        description="Pindai QR code aset atau barcode barang. Hasil hanya ditampilkan untuk konfirmasi — tidak ada data yang diubah di sini."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <GlassCard>
          <CardHeader>
            <CardTitle className="text-white">Kamera</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {cameraError && (
              <div className="rounded-lg border border-brand-500/25 bg-brand-500/15 p-3 text-sm text-brand-100">
                {cameraError} Pastikan izin kamera diberikan dan halaman diakses via HTTPS.
              </div>
            )}
            <div>
              <Label className="text-white" htmlFor="camera">Pilih Kamera</Label>
              <Select className="border-white/15 bg-white/10 text-white [color-scheme:dark]"
                id="camera"
                value={cameraId}
                onValueChange={setCameraId}
                disabled={scanning || cameras.length === 0}
                placeholder={cameras.length === 0 ? "Mencari kamera…" : "Pilih kamera"}
                options={cameras.map((c) => ({
                  value: c.id,
                  label: c.label || `Kamera ${c.id.slice(0, 8)}`,
                }))}
              />
            </div>

            <div
              id="qr-reader"
              className="overflow-hidden rounded-lg border border-white/15 bg-ink-800"
              style={{ minHeight: scanning ? 320 : 0 }}
            />

            <div className="flex gap-2">
              {!scanning ? (
                <Button
                  onClick={() => void startScanner()}
                  disabled={starting || cameras.length === 0}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  {starting ? "Memulai…" : "Mulai Scan"}
                </Button>
              ) : (
                <Button variant="destructive" onClick={() => void stopScanner()}>
                  <CameraOff className="mr-2 h-4 w-4" /> Berhenti
                </Button>
              )}
            </div>
          </CardContent>
        </GlassCard>

        <div className="space-y-6">
          <GlassCard>
            <CardHeader>
              <CardTitle className="text-white">Input Manual</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-white" htmlFor="manual">Kode / hasil pindaian</Label>
                <div className="flex gap-2">
                  <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
                    id="manual"
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleManualSearch();
                    }}
                    placeholder="Ketik kode aset, SKU, atau tempel hasil scan"
                  />
                  <Button onClick={handleManualSearch} disabled={resolving}>
                    <Search className="mr-2 h-4 w-4" /> Cari
                  </Button>
                </div>
              </div>
              <p className="text-xs text-ink-300">
                Fallback bila kamera tidak tersedia atau kode tidak terbaca.
              </p>
            </CardContent>
          </GlassCard>

          <GlassCard>
            <CardHeader>
              <CardTitle className="text-white">Hasil Konfirmasi</CardTitle>
            </CardHeader>
            <CardContent>
              {resolving && (
                <p className="text-sm text-ink-300">Mencari di database…</p>
              )}
              {!resolving && !result && (
                <p className="text-sm text-ink-300">
                  Belum ada hasil. Mulai scan atau gunakan input manual.
                </p>
              )}
              {!resolving && result && (
                <div className="space-y-3">
                  {result.kind === "public" && (
                    <>
                      <p className="text-sm text-white">
                        Terdeteksi <strong>tautan publik aset</strong> dengan kode{" "}
                        <code className="rounded bg-white/10 px-1 text-ink-100">{result.publicCode}</code>.
                      </p>
                      <Button
                        onClick={() => window.open(result.url, "_blank", "noreferrer")}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" /> Buka Detail Publik
                      </Button>
                    </>
                  )}
                  {result.kind === "asset" && (
                    <>
                      <p className="text-sm text-white">
                        Aset ditemukan: <strong>{result.name}</strong>{" "}
                        <span className="text-ink-300">({result.asset_code})</span>
                      </p>
                      <Button onClick={() => navigate(`/aset/${result.id}`)}>
                        Buka Detail Aset
                      </Button>
                    </>
                  )}
                  {result.kind === "item" && (
                    <>
                      <p className="text-sm text-white">
                        Barang ditemukan: <strong>{result.name}</strong>{" "}
                        <span className="text-ink-300">({result.sku})</span>
                      </p>
                      <Button onClick={() => navigate(`/persediaan/${result.id}`)}>
                        Buka Detail Barang
                      </Button>
                    </>
                  )}
                  {result.kind === "raw" && (
                    <>
                      <p className="text-sm text-ink-300">
                        Tidak ditemukan di database. Teks mentah hasil pindaian:
                      </p>
                      <code className="block break-all rounded bg-white/10 p-3 text-sm text-white">
                        {result.text}
                      </code>
                      <Button variant="outline" className={DARK_OUTLINE_BTN} onClick={() => void copyRaw(result.text)}>
                        {copied ? (
                          <>
                            <Check className="mr-2 h-4 w-4" /> Tersalin
                          </>
                        ) : (
                          <>
                            <Copy className="mr-2 h-4 w-4" /> Salin
                          </>
                        )}
                      </Button>
                    </>
                  )}
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-ink-300 hover:bg-white/10 hover:text-white"
                      onClick={() => {
                        setResult(null);
                        setCopied(false);
                      }}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" /> Pindai Lagi
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
