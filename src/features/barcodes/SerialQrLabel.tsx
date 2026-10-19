import { QRCodeSVG } from "qrcode.react";

/** Label 20 × 15 mm: nama di atas, QR dengan quiet zone, lalu nomor, seperti referensi. */
export function SerialQrLabel({ code, header = "SiCepat" }: { code: string; header?: string }) {
  return (
    <div className="serial-qr-label" style={{
      width: "20mm", height: "15mm", boxSizing: "border-box", padding: "0.3mm",
      border: "0.2mm solid black", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", background: "white", color: "black",
      overflow: "hidden", flexShrink: 0,
    }}>
      <div className="serial-label-header" style={{ width: "100%", fontFamily: "Arial, sans-serif", fontWeight: 900,
        fontSize: "6pt", lineHeight: "2.1mm", height: "2.1mm", flexShrink: 0,
        textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{header}</div>
      <QRCodeSVG value={code} size={96} level="M" includeMargin
        style={{ width: "10mm", height: "10mm", flexShrink: 0 }} aria-label={`QR ${code}`} />
      <div className="serial-label-number" style={{ fontFamily: "monospace", fontWeight: 700,
        fontSize: "6pt", lineHeight: "1.9mm", whiteSpace: "nowrap", flexShrink: 0 }}>{code}</div>
    </div>
  );
}
