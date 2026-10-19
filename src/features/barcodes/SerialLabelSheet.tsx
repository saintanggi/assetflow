import { SerialQrLabel } from "./SerialQrLabel";
import { DEFAULT_SHEET_OPTIONS, resolveSheetOptions, SERIAL_SHEET, SHEET_PRESETS, serialSheetPages } from "./serialSheetLayout";
import type { SerialSheetOptions } from "./serialSheetLayout";

/** Komponen ini dipakai persis sama pada pratinjau dan HTML cetak, tanpa CSS Tailwind. */
export function SerialLabelSheet({ codes, options = DEFAULT_SHEET_OPTIONS }: { codes: string[]; options?: SerialSheetOptions }) {
  const settings = resolveSheetOptions(options);
  const layout = SHEET_PRESETS[settings.preset];
  const pages = serialSheetPages(codes, settings);
  return <>{pages.map((page, index) => <section key={index} className="serial-label-sheet"
    aria-label={`Lembar ${index + 1} dari ${pages.length}`} data-page={index + 1}
    style={{
      width: `${SERIAL_SHEET.width}mm`, height: `${SERIAL_SHEET.height}mm`, boxSizing: "border-box",
      padding: `${layout.marginY}mm ${layout.marginX}mm`, display: "grid",
      gridTemplateColumns: `repeat(${SERIAL_SHEET.columns}, ${SERIAL_SHEET.labelWidth}mm)`,
      gridTemplateRows: `repeat(${layout.rows}, ${SERIAL_SHEET.labelHeight}mm)`,
      columnGap: `${layout.gapX}mm`, rowGap: `${layout.gapY}mm`,
      alignContent: "start", justifyContent: "start", background: "white", color: "black", flexShrink: 0,
    }}>
    {page.map((code) => <SerialQrLabel key={code} code={code} header={settings.header} />)}
  </section>)}</>;
}
