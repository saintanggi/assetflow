import { useCallback, useEffect, useState } from "react";
import type { HTMLAttributes } from "react";
import { useSearchParams } from "react-router-dom";
import { Printer, Plus, X, Search } from "lucide-react";
import { supabase, publicAssetUrl } from "../lib/supabase";
import { cn } from "../lib/utils";
import { buildSearchPattern } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { QrLabel } from "../features/barcodes/QrLabel";
import { BarcodeLabel } from "../features/barcodes/BarcodeLabel";
import { toast } from "sonner";

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

interface LabelItem {
  kind: "asset" | "item";
  id: string;
  title: string;
  code: string;
  /** Untuk aset: URL publik yang di-encode ke QR. */
  qrValue: string;
  /** Untuk barang: nilai barcode (SKU/barcode). */
  barcodeValue: string;
}

interface AssetSearchRow {
  id: string;
  asset_code: string;
  name: string;
  public_code: string;
}

interface ItemSearchRow {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
}

export function LabelPrintPage() {
  const [searchParams] = useSearchParams();
  const [labels, setLabels] = useState<LabelItem[]>([]);

  const [assetQuery, setAssetQuery] = useState("");
  const [assetResults, setAssetResults] = useState<AssetSearchRow[]>([]);
  const [itemQuery, setItemQuery] = useState("");
  const [itemResults, setItemResults] = useState<ItemSearchRow[]>([]);

  const addLabel = useCallback((label: LabelItem) => {
    setLabels((prev) => {
      if (prev.some((l) => l.kind === label.kind && l.id === label.id)) {
        toast.info("Label sudah ada di daftar");
        return prev;
      }
      return [...prev, label];
    });
  }, []);

  const removeLabel = (kind: LabelItem["kind"], id: string) => {
    setLabels((prev) => prev.filter((l) => !(l.kind === kind && l.id === id)));
  };

  // Preload dari query ?asset=<id> & ?sku=<id>
  useEffect(() => {
    const assetId = searchParams.get("asset");
    const skuId = searchParams.get("sku");
    if (!assetId && !skuId) return;
    void (async () => {
      if (assetId) {
        const { data } = await supabase
          .from("assets")
          .select("id, asset_code, name, public_code")
          .eq("id", assetId)
          .maybeSingle();
        const a = data as AssetSearchRow | null;
        if (a) {
          addLabel({
            kind: "asset",
            id: a.id,
            title: a.name,
            code: a.asset_code,
            qrValue: publicAssetUrl(a.public_code),
            barcodeValue: "",
          });
        }
      }
      if (skuId) {
        const { data } = await supabase
          .from("inventory_items")
          .select("id, sku, name, barcode")
          .eq("id", skuId)
          .maybeSingle();
        const it = data as ItemSearchRow | null;
        if (it) {
          addLabel({
            kind: "item",
            id: it.id,
            title: it.name,
            code: it.sku,
            qrValue: "",
            barcodeValue: it.sku || it.barcode || "",
          });
        }
      }
    })();
  }, [searchParams, addLabel]);

  const searchAssets = async (term: string) => {
    setAssetQuery(term);
    const t = term.trim();
    if (t.length < 2) {
      setAssetResults([]);
      return;
    }
    const pat = buildSearchPattern(t);
    const { data } = await supabase
      .from("assets")
      .select("id, asset_code, name, public_code")
      .eq("archived", false)
      .or(`asset_code.ilike.${pat},name.ilike.${pat}`)
      .limit(8);
    setAssetResults((data ?? []) as AssetSearchRow[]);
  };

  const searchItems = async (term: string) => {
    setItemQuery(term);
    const t = term.trim();
    if (t.length < 2) {
      setItemResults([]);
      return;
    }
    const pat = buildSearchPattern(t);
    const { data } = await supabase
      .from("inventory_items")
      .select("id, sku, name, barcode")
      .or(`sku.ilike.${pat},name.ilike.${pat}`)
      .limit(8);
    setItemResults((data ?? []) as ItemSearchRow[]);
  };

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title="Cetak Label"
          description="Cari aset atau barang, tambahkan ke daftar, lalu cetak labelnya."
          actions={
            labels.length > 0 ? (
              <Button onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" /> Cetak ({labels.length})
              </Button>
            ) : undefined
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Panel kiri — disembunyikan saat print */}
        <div className="no-print space-y-6">
          <GlassCard>
            <CardHeader>
              <CardTitle className="text-white">Cari Aset</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-white" htmlFor="label-search-asset">Kode / nama aset</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
                  <Input
                    id="label-search-asset"
                    className="border-white/15 bg-white/10 pl-9 text-white placeholder:text-ink-300"
                    placeholder="Ketik min. 2 huruf…"
                    value={assetQuery}
                    onChange={(e) => void searchAssets(e.target.value)}
                  />
                </div>
              </div>
              {assetResults.length > 0 && (
                <ul className="divide-y divide-white/10 rounded-lg border border-white/15">
                  {assetResults.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-2 p-2 text-sm text-white"
                    >
                      <span>
                        <strong>{a.asset_code}</strong>{" "}
                        <span className="text-ink-300">{a.name}</span>
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className={DARK_OUTLINE_BTN}
                        onClick={() => {
                          addLabel({
                            kind: "asset",
                            id: a.id,
                            title: a.name,
                            code: a.asset_code,
                            qrValue: publicAssetUrl(a.public_code),
                            barcodeValue: "",
                          });
                          setAssetQuery("");
                          setAssetResults([]);
                        }}
                      >
                        <Plus className="mr-1 h-4 w-4" /> Tambah
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </GlassCard>

          <GlassCard>
            <CardHeader>
              <CardTitle className="text-white">Cari Barang</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-white" htmlFor="label-search-item">SKU / nama barang</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
                  <Input
                    id="label-search-item"
                    className="border-white/15 bg-white/10 pl-9 text-white placeholder:text-ink-300"
                    placeholder="Ketik min. 2 huruf…"
                    value={itemQuery}
                    onChange={(e) => void searchItems(e.target.value)}
                  />
                </div>
              </div>
              {itemResults.length > 0 && (
                <ul className="divide-y divide-white/10 rounded-lg border border-white/15">
                  {itemResults.map((it) => (
                    <li
                      key={it.id}
                      className="flex items-center justify-between gap-2 p-2 text-sm text-white"
                    >
                      <span>
                        <strong>{it.sku}</strong>{" "}
                        <span className="text-ink-300">{it.name}</span>
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className={DARK_OUTLINE_BTN}
                        onClick={() => {
                          addLabel({
                            kind: "item",
                            id: it.id,
                            title: it.name,
                            code: it.sku,
                            qrValue: "",
                            barcodeValue: it.sku || it.barcode || "",
                          });
                          setItemQuery("");
                          setItemResults([]);
                        }}
                      >
                        <Plus className="mr-1 h-4 w-4" /> Tambah
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </GlassCard>

          <GlassCard>
            <CardHeader>
              <CardTitle className="text-white">Daftar Label ({labels.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {labels.length === 0 ? (
                <p className="text-sm text-ink-300">
                  Belum ada label. Cari aset/barang di atas lalu tambahkan.
                </p>
              ) : (
                <ul className="space-y-2">
                  {labels.map((l) => (
                    <li
                      key={`${l.kind}-${l.id}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-white/15 p-2 text-sm text-white"
                    >
                      <span>
                        <span className="mr-2 rounded bg-white/10 px-1.5 py-0.5 text-xs uppercase text-ink-300">
                          {l.kind === "asset" ? "Aset" : "Barang"}
                        </span>
                        <strong>{l.code}</strong>{" "}
                        <span className="text-ink-300">{l.title}</span>
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-ink-300 hover:bg-white/10 hover:text-white"
                        onClick={() => removeLabel(l.kind, l.id)}
                        aria-label={`Hapus label ${l.code}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </GlassCard>
        </div>

        {/* Panel kanan — area cetak */}
        <div className="lg:col-span-2">
          <div id="print-area" className="flex flex-wrap gap-3">
            {labels.map((l) => (
              <div
                key={`${l.kind}-${l.id}`}
                className="flex flex-col items-center justify-between border border-ink-300 bg-white p-2 text-center text-ink-900"
                style={{ width: "90mm", height: "60mm" }}
              >
                <div
                  className="w-full overflow-hidden text-xs font-bold leading-tight"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {l.title}
                </div>
                <div className="text-xs text-ink-500">{l.code}</div>
                {l.kind === "asset" ? (
                  <QrLabel value={l.qrValue} size={110} showDownload={false} />
                ) : (
                  <BarcodeLabel
                    value={l.barcodeValue}
                    height={52}
                    showDownload={false}
                  />
                )}
              </div>
            ))}
            {labels.length === 0 && (
              <p className="no-print text-sm text-ink-300">
                Pratinjau label akan muncul di sini.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
