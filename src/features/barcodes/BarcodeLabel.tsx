import { useEffect, useId, useRef } from "react";
import JsBarcode from "jsbarcode";
import { Download } from "lucide-react";
import { Button } from "../../components/ui/button";

interface BarcodeLabelProps {
  /** Nilai barcode — untuk persediaan: SKU. */
  value: string;
  fileName?: string;
  showDownload?: boolean;
  height?: number;
}

export function BarcodeLabel({
  value,
  fileName = "barcode",
  showDownload = true,
  height = 60,
}: BarcodeLabelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format: "CODE128",
          height,
          displayValue: true,
          fontSize: 14,
          margin: 8,
        });
      } catch {
        // nilai tidak valid untuk CODE128 — biarkan kosong
      }
    }
  }, [value, height]);

  const serialize = (): string | null => {
    if (!svgRef.current) return null;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return new XMLSerializer().serializeToString(clone);
  };

  const triggerDownload = (href: string, name: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadSvg = () => {
    const s = serialize();
    if (!s) return;
    const blob = new Blob([s], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `${fileName}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadPng = () => {
    const s = serialize();
    if (!s) return;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([s], { type: "image/svg+xml;charset=utf-8" }));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width * 3;
      canvas.height = img.height * 3;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      triggerDownload(canvas.toDataURL("image/png"), `${fileName}.png`);
    };
    img.src = url;
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <svg ref={svgRef} role="img" aria-labelledby={titleId} />
        <title id={titleId}>Barcode {value}</title>
      </div>
      {showDownload && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={downloadPng}>
            <Download className="h-3.5 w-3.5" /> PNG
          </Button>
          <Button variant="outline" size="sm" onClick={downloadSvg}>
            <Download className="h-3.5 w-3.5" /> SVG
          </Button>
        </div>
      )}
    </div>
  );
}
