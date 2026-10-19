import { renderToStaticMarkup } from "react-dom/server";
import { SerialLabelSheet } from "./SerialLabelSheet";
import { DEFAULT_SHEET_OPTIONS } from "./serialSheetLayout";
import type { SerialSheetOptions } from "./serialSheetLayout";

/** Dokumen terpisah: pagination eksplisit per kertas 100 × 150 mm, bukan per stiker. */
export function serialPrintDocument(codes: string[], options: SerialSheetOptions = DEFAULT_SHEET_OPTIONS): string {
  const sheets = renderToStaticMarkup(<SerialLabelSheet codes={codes} options={options} />);
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Label QR · Kertas 100 × 150 mm</title>
<style>@page{size:100mm 150mm;margin:0}html,body{margin:0;padding:0;background:white}
body{width:100mm}*{box-sizing:border-box}
.serial-label-sheet{break-inside:avoid;page-break-inside:avoid;break-after:page;page-break-after:always}
.serial-label-sheet:last-child{break-after:auto;page-break-after:auto}
.serial-qr-label{break-inside:avoid;page-break-inside:avoid}
@media screen{body{background:#e5e7eb}.serial-label-sheet{margin-bottom:12px}}
</style></head><body>${sheets}</body></html>`;
}

export function printSerialLabels(codes: string[], options: SerialSheetOptions = DEFAULT_SHEET_OPTIONS): Promise<void> {
  const html = serialPrintDocument(codes, options);
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.title = "Dokumen cetak label QR";
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:100mm;height:150mm;border:0";
    const cleanup = () => frame.remove();
    frame.onload = () => {
      const target = frame.contentWindow;
      if (!target) { cleanup(); reject(new Error("Dokumen cetak tidak dapat dibuka")); return; }
      target.addEventListener("afterprint", cleanup, { once: true });
      // Fallback untuk browser yang tidak mengirim afterprint. Tidak merekam klaim 'berhasil dicetak'.
      window.setTimeout(cleanup, 300_000);
      try { target.focus(); target.print(); resolve(); }
      catch (error) { cleanup(); reject(error); }
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
