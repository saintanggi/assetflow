import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  SHIPPING_HEADERS,
  aggregateGroup,
  buildDupIndex,
  filterDuplicateRows,
  findDuplicateRowsInFile,
  groupKeyOf,
  kondisiOf,
  parseDateText,
  parseQtyCell,
  parseSheetDate,
  parseShippingSheet,
  type ParsedShippingRow,
} from "./shippingUpload";

/** Bangun sheet seperti file "Dokumen Pengiriman" lalu baca dengan parser produksi. */
function readSheet(rows: (string | number | Date | "")[][], merges?: XLSX.Range[]) {
  const aoa: (string | number | Date | "")[][] = [[...SHIPPING_HEADERS], ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (merges) ws["!merges"] = merges;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "PENGIRIMAN");
  const raw = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const wb2 = XLSX.read(raw, { cellDates: true });
  const aoaBack = XLSX.utils.sheet_to_json<unknown[]>(wb2.Sheets["PENGIRIMAN"], { header: 1, defval: "" });
  return parseShippingSheet(aoaBack);
}

const NAME_KEY = (r: ParsedShippingRow) => r.itemName.toUpperCase();

const kursiRow = (qty: number | "", resi: string): (string | number)[] => [
  "2026-10-14", "EMAIL", "Semarang Sortation (HLDP Batch 2)", "1401007", "KURSI TRAINING",
  qty, "SUDAH", resi, "", "", "PINJAM 1 MINGGU", "ASSET RETUR", "TERKIRIM",
];

describe("QTY baris lanjutan (bug 23 jadi 45)", () => {
  it("baris tanpa QTY tidak lagi dihitung 1, jadi total tetap 23", () => {
    const rows = [
      ["2026-10-14", "A2610140947", "Kalideres", "S1103001", "PRINTER TSC", 1, "", "999006740020", "A130026831", "", "PENAMBAHAN", "ASSET RETUR", "TERKIRIM"],
      // 1 baris membawa QTY 23, 22 baris berikutnya kosong (satu sel QTY di-merge).
      kursiRow(23, "RESI-KURSI-0"),
      ...Array.from({ length: 22 }, (_, i) => kursiRow("", `RESI-KURSI-${i + 1}`)),
    ];
    const { rows: parsed } = readSheet(rows);
    const lines = aggregateGroup(parsed, NAME_KEY);
    const kursi = lines.find((l) => l.itemKey === "KURSI TRAINING");
    const printer = lines.find((l) => l.itemKey === "PRINTER TSC");
    expect(kursi?.qty).toBe(23); // sebelum diperbaiki: 23 + 22 = 45
    expect(kursi?.blankQtyRows).toBe(22);
    expect(kursi?.qtyFile).toBe(23);
    expect(kursi?.qtySource).toBe("qty-kolom");
    // 23 resi tetap tercatat (tidak ada data yang hilang).
    expect(kursi?.rows.map((r) => r.resi)).toHaveLength(23);
    expect(new Set(kursi?.rows.map((r) => r.resi)).size).toBe(23);
    expect(printer?.qty).toBe(1);
  });

  it("satu sel QTY yang di-merge untuk 23 baris tetap terbaca 23", () => {
    const rows: (string | number)[][] = [
      ["2026-10-14", "EMAIL", "Semarang Sortation (HLDP Batch 2)", "1401007", "KURSI TRAINING", 23, "SUDAH", "999006742866", "", "", "", "ASSET RETUR", "TERKIRIM"],
      ...Array.from({ length: 22 }, (_, i) => kursiRow("", `RESI-KURSI-${i + 1}`)),
    ];
    // Kolom QTY (index 5) di-merge dari baris pertama blok ke 22 baris berikutnya.
    const { rows: parsed } = readSheet(rows, [{ s: { r: 1, c: 5 }, e: { r: 23, c: 5 } }]);
    const line = aggregateGroup(parsed, NAME_KEY)[0];
    expect(parsed.every((r) => r.qtyExplicit || r.qty === 0)).toBe(true);
    expect(line.qty).toBe(23);
  });

  it("QTY kosong + BARCODE tetap dihitung 1 unit", () => {
    const rows = [
      ["2026-10-14", "T1", "Gerai", "1", "LAPTOP", "", "", "RESI-1", "BC-1", "", "", "ASSET BARU", "TERKIRIM"],
      ["2026-10-14", "T1", "Gerai", "1", "LAPTOP", "", "", "RESI-2", "BC-2", "", "", "ASSET BARU", "TERKIRIM"],
    ];
    const { rows: parsed } = readSheet(rows);
    const lines = aggregateGroup(parsed, NAME_KEY);
    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(2);
    expect(lines[0].blankQtyRows).toBe(0);
  });

  it("bila kolom QTY kosong di semua baris, qty = jumlah baris (ditandai)", () => {
    const rows = Array.from({ length: 4 }, (_, i) => kursiRow("", `R-${i}`));
    const { rows: parsed } = readSheet(rows);
    const lines = aggregateGroup(parsed, NAME_KEY);
    expect(lines[0].qty).toBe(4);
    expect(lines[0].qtyFile).toBe(0);
    expect(lines[0].qtySource).toBe("jumlah-baris");
  });

  it("baris ASSET BARU dan ASSET RETUR tidak digabung", () => {
    const rows = [
      kursiRow(2, "R-1"),
      ["2026-10-14", "EMAIL", "Semarang Sortation (HLDP Batch 2)", "1401007", "KURSI TRAINING", 3, "", "R-2", "", "", "", "ASSET BARU", "TERKIRIM"],
    ];
    const { rows: parsed } = readSheet(rows);
    const byKondisi = Object.fromEntries(aggregateGroup(parsed, NAME_KEY).map((l) => [l.kodeKondisi, l.qty]));
    expect(byKondisi).toEqual({ "STOK-RETUR": 2, "STOK-BARU": 3 });
  });
});

describe("simulasi file pengguna (screenshot 14-Okt-26)", () => {
  it("menghasilkan 2 permintaan dan qty KURSI TRAINING = 23 (bukan 45)", () => {
    const rows: (string | number)[][] = [
      ["14-Oct-26", "A2610140947", "SiCepat Ekspres Jakarta Kalideres Sortation", "S1103001", "PRINTER TSC", 1, "24P24350274", "999006740020", "A130026831", "", "PENAMBAHAN", "ASSET RETUR", "TERKIRIM"],
      ["14-Oct-26", "A2610140947", "SiCepat Ekspres Jakarta Kalideres Sortation", "S1103001", "TIMBANGAN TOLEDO + KABEL", 1, "B929986917", "999006740071", "A0700054332", "", "PENAMBAHAN", "ASSET RETUR", "TERKIRIM"],
      ["14-Oct-26", "A2610140947", "SiCepat Ekspres Jakarta Kalideres Sortation", "S1103001", "CAMERA IPEVO", 1, "332037VAF09195", "999006740005", "202610006552", "", "PENAMBAHAN", "ASSET RETUR", "TERKIRIM"],
      // 23 baris KURSI TRAINING, hanya baris pertama yang mengisi QTY (sel di-merge).
      ["14-Oct-26", "EMAIL", "Semarang Sortation (HLDP Batch 2)", "1401007", "KURSI TRAINING", 23, "SUDAH", "999006742866", "", "", "PINJAM 1 MINGGU", "ASSET RETUR", "TERKIRIM"],
      ...Array.from({ length: 22 }, (_, i) => [
        "14-Oct-26", "EMAIL", "Semarang Sortation (HLDP Batch 2)", "1401007", "KURSI TRAINING",
        "", "SUDAH", `99900674${2831 + i * 2}`, "", "", "PINJAM 1 MINGGU", "ASSET RETUR", "TERKIRIM",
      ] as (string | number)[]),
    ];
    const { rows: parsed } = readSheet(rows);

    // Semua tanggal teks "14-Oct-26" harus jadi 2026-10-14 (dulu jatuh ke tanggal hari ini).
    expect(new Set(parsed.map((r) => r.date))).toEqual(new Set(["2026-10-14"]));

    // Dikelompokkan per tanggal + gerai + tiket.
    const groups = new Map<string, ParsedShippingRow[]>();
    for (const r of parsed) {
      const key = groupKeyOf(r);
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    expect(groups.size).toBe(2);

    const kursiGroup = groups.get("2026-10-14|Semarang Sortation (HLDP Batch 2)|EMAIL") ?? [];
    const lines = aggregateGroup(kursiGroup, NAME_KEY);
    expect(lines).toHaveLength(1);
    expect(lines[0].itemName).toBe("KURSI TRAINING");
    expect(lines[0].kodeKondisi).toBe("STOK-RETUR");
    // Nilai yang masuk ke request_items.qty_requested/qty_approved:
    expect(lines[0].qty).toBe(23);
    // resi digabung (satu per baris) seperti payload upload:
    const resiGabung = [...new Set(lines[0].rows.map((x) => x.resi).filter(Boolean))];
    expect(resiGabung).toHaveLength(23);
  });
});

describe("pola file lapangan (screenshot 13/14-Okt-26)", () => {
  // Baris nyata dari file: satu blok barang bisa 1..25 baris dan kolom QTY
  // di-merge di baris pertama blok.
  const row = (
    ticket: string, branch: string, item: string, qty: number | "", ket: string,
    resi: string, barcode: string, aset = "ASSET RETUR",
  ): (string | number)[] => [
    "13-Oct-26", ticket, branch, "1420006", item, qty, ket, resi, barcode, "", "PERGANTIAN", aset, "TERKIRIM",
  ];

  it("blok 4 baris dengan QTY 4 (SCANNER WIRELESS) tetap 4 unit", () => {
    const rows = [
      row("A2610130880", "Klaten Utara", "SCANNER WIRELESS", 4, "CS22036219819", "999006738631", "40259"),
      row("A2610130880", "Klaten Utara", "SCANNER WIRELESS", "", "CS22036219816", "999006738631", "39959"),
      row("A2610130880", "Klaten Utara", "SCANNER WIRELESS", "", "CS22036219824", "999006738631", "41659"),
      row("A2610130880", "Klaten Utara", "SCANNER WIRELESS", "", "CS22036219808", "999006738631", "40059"),
    ];
    const { rows: parsed } = readSheet(rows);
    const line = aggregateGroup(parsed, NAME_KEY)[0];
    expect(line.qty).toBe(4); // dulu 4 + 3 baris kosong = 7
    expect(line.qtySource).toBe("qty-kolom");
    expect(line.qtyFile).toBe(4);
    expect(line.qtyBarcode).toBe(4);
  });

  it("blok 25 baris (SCANNER KABEL 2D) dengan QTY 25 tetap 25", () => {
    const rows: (string | number)[][] = [
      row("A2610120822", "Bogor Sukaraja FM", "SCANNER KABEL 2D", 25, "21051817902", "999006738856", "A1100064419"),
      ...Array.from({ length: 20 }, (_, i) =>
        row("A2610120822", "Bogor Sukaraja FM", "SCANNER KABEL 2D", "", "tanpa sn", "999006738856", `A1100033${820 + i}`)),
      // 4 baris tanpa barcode sama sekali (tanpa sn).
      ...Array.from({ length: 4 }, () =>
        row("A2610120822", "Bogor Sukaraja FM", "SCANNER KABEL 2D", "", "TANPA SN", "999006738856", "")),
    ];
    const { rows: parsed } = readSheet(rows);
    const line = aggregateGroup(parsed, NAME_KEY)[0];
    expect(line.qty).toBe(25); // dulu 25 + 24 = 49
    expect(line.rowCount).toBe(25);
    expect(line.qtyBarcode).toBe(21);
  });

  it("QTY 15 dengan 13 barcode (ada baris tanpa SN) tetap 15", () => {
    const rows = [
      row("A2610120823", "Cibitung Eureup FM", "SCANNER KABEL 2D", 15, "CS21060913342", "999006738877", "A0800094454"),
      ...Array.from({ length: 12 }, (_, i) =>
        row("A2610120823", "Cibitung Eureup FM", "SCANNER KABEL 2D", "", "sn", "999006738877", `A070008${170 + i}`)),
      row("A2610120823", "Cibitung Eureup FM", "SCANNER KABEL 2D", "", "TANPA SN", "999006738877", ""),
    ];
    const { rows: parsed } = readSheet(rows);
    const line = aggregateGroup(parsed, NAME_KEY)[0];
    expect(line.qty).toBe(15);
    expect(line.qtySource).toBe("qty-kolom");
  });

  it("QTY lebih kecil dari jumlah barcode -> dipakai jumlah barcode + ditandai", () => {
    // Di file nyata: SCANNER WIRELESS Demak LM tertulis QTY 1 tetapi ada 2 baris
    // dengan 2 barcode berbeda (2 unit fisik) — jangan sampai tercatat 1.
    const rows = [
      row("A2610080540", "SiCepat Ekspres Demak LM", "PRINTER CANON LASERJET", 1, "NQSA111830", "999006738290", "A1300027867", "ASSET RETUR"),
      row("A2610080540", "SiCepat Ekspres Demak LM", "SCANNER WIRELESS", 1, "CS22036219812", "999006738290", "39559", "ASSET BARU"),
      row("A2610080540", "SiCepat Ekspres Demak LM", "SCANNER WIRELESS", "", "CS22036219827", "999006738290", "41559", "ASSET BARU"),
    ];
    const { rows: parsed } = readSheet(rows);
    const lines = aggregateGroup(parsed, NAME_KEY);
    const scanner = lines.find((l) => l.itemName === "SCANNER WIRELESS")!;
    expect(scanner.qty).toBe(2);
    expect(scanner.qtySource).toBe("barcode");
    expect(scanner.qtyFile).toBe(1);
    const printer = lines.find((l) => l.itemName === "PRINTER CANON LASERJET")!;
    expect(printer.qty).toBe(1);
  });

  it("blok 15 baris dengan 1 baris ASSET BARU di dalamnya: QTY file 15 dibagi 14 + 1", () => {
    // Kasus nyata A2610120823 (Bogor Citeureup): QTY 15 di-merge, 14 baris
    // ASSET RETUR + 1 baris ASSET BARU, jadi tidak boleh 15 + 1.
    const rows: (string | number)[][] = [
      ["13-Oct-26", "A2610120823", "SiCepat Ekspres Bogor Citeureup FM", "1223009", "SCANNER KABEL 2D", 15, "CS21060913342", "", "", "", "PERGANTIAN", "ASSET RETUR", "TERKIRIM"],
      ...Array.from({ length: 13 }, (_, i) => [
        "13-Oct-26", "A2610120823", "SiCepat Ekspres Bogor Citeureup FM", "1223009", "SCANNER KABEL 2D",
        "", i === 7 || i === 9 ? "TANPA SN" : `CS21040${905970 + i}`, "", "", "", "PERGANTIAN", "ASSET RETUR", "TERKIRIM",
      ] as (string | number)[]),
      ["13-Oct-26", "A2610120823", "SiCepat Ekspres Bogor Citeureup FM", "1223009", "SCANNER KABEL 2D", "", "5J202009104", "", "", "", "PERGANTIAN", "ASSET BARU", "TERKIRIM"],
    ];
    const { rows: parsed } = readSheet(rows);
    const lines = aggregateGroup(parsed, NAME_KEY);
    const byKondisi = Object.fromEntries(lines.map((l) => [l.kodeKondisi, l.qty]));
    expect(byKondisi).toEqual({ "STOK-RETUR": 14, "STOK-BARU": 1 });
    expect(lines.reduce((s, l) => s + l.qty, 0)).toBe(15);
  });

  it("QTY 3 yang hanya ditulis 1 baris tetap 3 unit (kasus oSD Ezviz)", () => {
    const rows = [
      ["13-Oct-26", "A2610130910", "SiCepat Ekspres Deli Serdang Tanjung Morawa", "T0216002", "oSD Ezviz Smart Micro SD Card 64 Gb", 3, "SUDAH", "", "", "", "PENAMBAHAN", "ASSET BARU", "TERKIRIM"],
    ];
    const { rows: parsed } = readSheet(rows);
    const line = aggregateGroup(parsed, NAME_KEY)[0];
    expect(line.qty).toBe(3);
    expect(line.qtyFile).toBe(3);
    expect(line.rowCount).toBe(1);
  });

  it("satu tiket berisi banyak barang: qty tiap barang dihitung terpisah", () => {
    const rows = [
      row("A2610130921", "Depok Margonda", "MOUSE", 2, "2A113479", "999006739585", ""),
      row("A2610130921", "Depok Margonda", "MOUSE", "", "2A1134795", "999006739585", ""),
      row("A2610130921", "Depok Margonda", "TROLLY BARANG", 6, "SUDAH", "999006739585", ""),
      ...Array.from({ length: 5 }, () => row("A2610130921", "Depok Margonda", "TROLLY BARANG", "", "SUDAH", "999006739585", "")),
      row("A2610130921", "Depok Margonda", "KEYBOARD", 3, "2145SC32", "999006739596", ""),
      row("A2610130921", "Depok Margonda", "KEYBOARD", "", "TL74PSS", "999006739596", ""),
      row("A2610130921", "Depok Margonda", "KEYBOARD", "", "TL75Q2YH", "999006739596", ""),
    ];
    const { rows: parsed } = readSheet(rows);
    const got = Object.fromEntries(aggregateGroup(parsed, NAME_KEY).map((l) => [l.itemName, l.qty]));
    expect(got).toEqual({ MOUSE: 2, "TROLLY BARANG": 6, KEYBOARD: 3 });
  });
});

describe("parseQtyCell", () => {
  it("menerima angka, teks, dan pemisah ribuan Indonesia", () => {
    expect(parseQtyCell(23, false)).toEqual({ qty: 23, explicit: true, unreadable: false });
    expect(parseQtyCell("23 unit", false).qty).toBe(23);
    expect(parseQtyCell("1.234", false).qty).toBe(1234);
    expect(parseQtyCell("23,5", false).qty).toBe(23.5);
  });
  it("angka 0 / sel kosong = baris lanjutan (0), kecuali ada barcode", () => {
    expect(parseQtyCell(0, false).qty).toBe(0);
    expect(parseQtyCell(0, true).qty).toBe(1);
    expect(parseQtyCell("", false)).toEqual({ qty: 0, explicit: false, unreadable: false });
    expect(parseQtyCell("", true).qty).toBe(1);
  });
  it("menandai QTY yang tidak terbaca", () => {
    const p = parseQtyCell("dua puluh", false);
    expect(p.unreadable).toBe(true);
    expect(p.qty).toBe(0);
    expect(parseQtyCell("dua puluh", true).qty).toBe(1);
  });
});

describe("tanggal", () => {
  it("Date tengah malam lokal tidak bergeser satu hari (WIB/UTC+7)", () => {
    // Sebelum diperbaiki: toISOString() -> "2026-10-13" untuk pengguna WIB.
    expect(parseSheetDate(new Date(2026, 9, 14))).toBe("2026-10-14");
  });
  it("menerima tanggal teks format Excel Indonesia", () => {
    expect(parseDateText("14-Oct-26")).toBe("2026-10-14");
    expect(parseDateText("14/10/2026")).toBe("2026-10-14");
    expect(parseDateText("2026-10-14")).toBe("2026-10-14");
    expect(parseDateText("14 Oktober 2026")).toBe("2026-10-14");
    expect(parseDateText("bukan tanggal")).toBeNull();
    expect(parseDateText("45/13/2026")).toBeNull();
  });
});

describe("deteksi duplikat", () => {
  const storedFromAggregated = [
    {
      ticket_no: "EMAIL",
      request_date: "2026-10-14",
      item_id: "item-kursi",
      // hasil upload sebelumnya: 1 baris item dengan 23 resi digabung
      barcode: null,
      resi: Array.from({ length: 23 }, (_, i) => `R-${i}`).join("\n"),
      qty_requested: 23,
    },
  ];

  it("upload ulang file yang sama tidak menggandakan qty", () => {
    const rows = [
      { ...({} as ParsedShippingRow), rowNo: 1, ticket: "EMAIL", date: "2026-10-14", itemName: "KURSI TRAINING", qty: 0, qtyExplicit: false, qtyUnreadable: false, hasBarcode: false, barcode: "", resi: "R-0", branch: "G", branchCode: "", ket: "", typeBarang: "", statusRequest: "", statusAset: "", terkirim: "TERKIRIM" },
      { ...({} as ParsedShippingRow), rowNo: 2, ticket: "EMAIL", date: "2026-10-14", itemName: "KURSI TRAINING", qty: 0, qtyExplicit: false, qtyUnreadable: false, hasBarcode: false, barcode: "", resi: "NEW-1", branch: "G", branchCode: "", ket: "", typeBarang: "", statusRequest: "", statusAset: "", terkirim: "TERKIRIM" },
    ];
    const index = buildDupIndex(storedFromAggregated);
    // itemKey harus sama dengan yang dipakai buildDupIndex (id barang), bukan nama.
    const { kept, skipped } = filterDuplicateRows(rows, () => "item-kursi", index);
    expect(skipped.map((r) => r.resi)).toEqual(["R-0"]);
    expect(kept.map((r) => r.resi)).toEqual(["NEW-1"]);
  });

  it("baris anonim dibandingkan berdasarkan total qty yang sudah tersimpan", () => {
    const index = buildDupIndex([
      { ticket_no: "T1", request_date: "2026-10-14", item_id: "I1", barcode: null, resi: null, qty_requested: 5 },
    ]);
    const rows = Array.from({ length: 7 }, (_, i) => ({
      ...({} as ParsedShippingRow), rowNo: i + 1, ticket: "T1", date: "2026-10-14", itemName: "ITEM", qty: 1,
      qtyExplicit: true, qtyUnreadable: false, hasBarcode: false, barcode: "", resi: "", branch: "G",
      branchCode: "", ket: "", typeBarang: "", statusRequest: "", statusAset: "", terkirim: "TERKIRIM",
    }));
    const { kept, skipped } = filterDuplicateRows(rows, () => "I1", index);
    expect(skipped).toHaveLength(5);
    expect(kept).toHaveLength(2);
  });

  it("baris dengan barcode sudah ada di sistem ikut dilewati", () => {
    const index = buildDupIndex([
      { ticket_no: "T1", request_date: "2026-10-14", item_id: "I1", barcode: "BC-9", resi: null, qty_requested: 1 },
    ]);
    const rows = [
      { ...({} as ParsedShippingRow), rowNo: 1, ticket: "T1", date: "2026-10-14", itemName: "ITEM", qty: 1, qtyExplicit: true, qtyUnreadable: false, hasBarcode: true, barcode: "BC-9", resi: "", branch: "G", branchCode: "", ket: "", typeBarang: "", statusRequest: "", statusAset: "", terkirim: "TERKIRIM" },
    ];
    expect(filterDuplicateRows(rows, () => "I1", index).skipped).toHaveLength(1);
  });
});

describe("util lain", () => {
  it("memetakan STATUS ASSET ke lokasi stok", () => {
    expect(kondisiOf("ASSET RETUR")).toBe("STOK-RETUR");
    expect(kondisiOf("ASSET RETURN")).toBe("STOK-RETUR");
    expect(kondisiOf("ASSET UNREADY")).toBe("STOK-UNREADY");
    expect(kondisiOf("ASSET BARU")).toBe("STOK-BARU");
    expect(kondisiOf("")).toBe("STOK-BARU");
  });

  it("mengelompokkan per tanggal + gerai + tiket", () => {
    const row = { date: "2026-10-14", branch: "Gerai A", ticket: "T1", itemName: "X" } as ParsedShippingRow;
    expect(groupKeyOf(row)).toBe("2026-10-14|Gerai A|T1");
    expect(groupKeyOf({ ...row, ticket: "" })).toBe("2026-10-14|Gerai A|ITEM:X");
  });

  it("menemukan baris dobel di dalam satu file", () => {
    const base = {
      date: "2026-10-14", branch: "G", branchCode: "", itemName: "ITEM", qty: 1, qtyExplicit: true,
      qtyUnreadable: false, hasBarcode: true, ket: "", typeBarang: "", statusRequest: "", statusAset: "",
      terkirim: "TERKIRIM",
    } as const;
    const rows = [
      { ...base, rowNo: 2, ticket: "T1", barcode: "BC-1", resi: "R1" },
      { ...base, rowNo: 3, ticket: "T1", barcode: "BC-1", resi: "R1" },
      { ...base, rowNo: 4, ticket: "T1", barcode: "BC-2", resi: "R2" },
    ] as ParsedShippingRow[];
    expect(findDuplicateRowsInFile(rows, NAME_KEY).map((r) => r.rowNo)).toEqual([3]);
  });

  it("melewati baris tanpa NAMA BARANG dan mencari baris header", () => {
    const { rows } = parseShippingSheet([
      ["LAPORAN PENGIRIMAN"],
      [...SHIPPING_HEADERS],
      ["2026-10-14", "T1", "G", "", "", "", "", "", "", "", "", "", ""],
      ["2026-10-14", "T1", "G", "", "KURSI", 23, "", "R1", "", "", "", "", ""],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].rowNo).toBe(4);
    expect(rows[0].qty).toBe(23);
  });

  it("menolak file tanpa kolom NAMA BARANG", () => {
    expect(() => parseShippingSheet([["A", "B"], ["1", "2"]])).toThrow(/NAMA BARANG/);
  });
});
