import { useId, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Download } from "lucide-react";
import { Button } from "../../components/ui/button";

interface QrLabelProps {
  /** Nilai yang di-encode — untuk aset: URL publik, TANPA data rahasia. */
  value: string;
  size?: number;
  fileName?: string;
  showDownload?: boolean;
}

export function QrLabel({ value, size = 160, fileName = "qr-code", showDownload = true }: QrLabelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const titleId = useId();

  const serialize = (): string | null => {
    if (!svgRef.current) return null;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return new XMLSerializer().serializeToString(clone);
  };

  const downloadSvg = () => {
    const s = serialize();
    if (!s) return;
    const blob = new Blob([s], { type: "image/svg+xml;charset=utf-8" });
    triggerDownload(URL.createObjectURL(blob), `${fileName}.svg`);
  };

  const downloadPng = () => {
    const s = serialize();
    if (!s) return;
    const img = new Image();
    const svgBlob = new Blob([s], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const scale = 4;
      const canvas = document.createElement("canvas");
      canvas.width = size * scale;
      canvas.height = size * scale;
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

  const triggerDownload = (href: string, name: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <QRCodeSVG
          ref={svgRef}
          value={value}
          size={size}
          level="M"
          includeMargin
          aria-labelledby={titleId}
        />
        <title id={titleId}>QR Code</title>
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
