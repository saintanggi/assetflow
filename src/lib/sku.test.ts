import { describe, expect, it } from "vitest";
import { familyCodeForName, formatSku, nextNumbers } from "./sku";

describe("familyCodeForName", () => {
  const cases: [string, string][] = [
    // Keluarga besar + pemisah indoor/outdoor.
    ["AC 2 PK", "ACI"],
    ["AC_Indoor_1_PK_Daikin", "ACI"],
    ["IN AC 1 PK", "ACI"],
    ["AC_Outdoor_2_PK_Sharp", "ACO"],
    ["AC OUT 1 1/2PK", "ACO"],
    ["OUT AC 1 PK", "ACO"],
    ["CCTV Indoor", "CCI"],
    ["CCTV Outdoor", "CCO"],
    ["IP Camera Indoor Ezviz", "IPC"],
    ["IP Camera Outdoor Ezviz", "IPC"],
    // Jebakan substring: "AC" di dalam kata lain bukan AC.
    ["Monitor PC Acer EB192Q", "MON"],
    ["Bag rack 1 Hole", "RAK"],
    ["Bracket PC 2 PC", "BRC"],
    ["Laci", "LAC"],
    // Jenis barang mengalahkan kegunaannya.
    ["Power Supply CCTV", "PSU"],
    ["Adaptor Camera", "ADP"],
    ["Adaptor DVR", "ADP"],
    ["Pesawat Telepon Kabel", "TLP"],
    ["KEYBOARD KABEL", "KBD"],
    ["Kabel OTG", "KBL"],
    ["Kabel OTG Type C", "KBL"],
    // Nama dengan typo tetap masuk keluarga yang benar.
    ["WHITBOARD BESAR", "WBD"],
    ["Whiteboard P 100 X L 90", "WBD"],
    ["Laci Filling", "LAC"],
    // Lainnya.
    ["Kipas Angin Wall 18\" Regency", "KIP"],
    ["Printer Thermal TP806", "PRN"],
    ["Printer Barcode_TTP-244 PRO", "PRN"],
    ["Scanner PDA Idata K3S", "SCN"],
    ["Scanner Wireless WC220SWG", "SCN"],
    ["Switch Hub 24 Port SF1008D", "SWH"],
    ["CPU Rakitan", "CPU"],
    ["PC ALL IN ONE", "CPU"],
    ["Mini PC Server Rakitan", "CPU"],
    ["Timbangan 150 KG Webowt", "TMB"],
    ["KURSI STAFF MERAH ( RODA )", "KRS"],
    ["KURSI TRAINING", "KRS"],
    ["Mesin Jahit", "MES"],
    ["Mesin CMD", "MES"],
    ["DVR 32 CH", "DVR"],
    ["Hardisk 8 TB", "HDD"],
    ["Micro SD 64 GB Ezviz", "MSD"],
    ["Kotak P3K", "P3K"],
    ["HANDPALLET", "HDP"],
    ["HANDPHONE ANDROID", "HPH"],
    ["Hook S", "HOK"],
    ["Baging Holder Besar", "HLD"],
    ["Meteran 5M Tekiro", "MET"],
    ["Mikrotik", "MIK"],
    ["Standing Karung", "STA"],
    ["Tangga Besi", "TAN"],
    ["WIRELESS GATEWAY", "GTW"],
    ["Camera Ipevo V4k", "CAM"],
    ["Rider Fine Sort", "RDR"],
    ["Rak Server 6U", "RKS"],
    ["Ram Besi Roda", "RMB"],
    ["Speaker PC", "SPK"],
    ["Meja 1/2 Biro", "MJA"],
    ["Lemari Arsip", "LEM"],
    ["Pallet Plastik", "PAL"],
    ["Air Purifier Standard", "APR"],
    ["APAR 6KG", "APF"],
    ["Brankas Sedang", "BRK"],
    ["EXHAUST FAN", "EXF"],
    ["Webcam PC", "WCM"],
    ["Chest Freezer Besar Changhong", "FRZ"],
    ["Dispenser Besar Miyako", "DSP"],
    ["Genset 8000 W Gambino", "GEN"],
    ["Modem GSM", "NET"],
    ["Wifi Router_TP-link", "NET"],
    ["Dongle Wifi", "NET"],
    ["UPS", "UPS"],
  ];
  for (const [name, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      expect(familyCodeForName(name)).toBe(expected);
    });
  }
});

describe("nextNumbers", () => {
  it("lanjut dari nomor terbesar di keluarga itu", () => {
    expect(nextNumbers(["ACI-001", "ACI-002", "ACI-015", "ACO-001"], ["ACI", "ACO"])).toEqual({
      ACI: 16,
      ACO: 2,
    });
  });
  it("keluarga baru mulai dari 1 dan SKU pola lama diabaikan", () => {
    expect(nextNumbers(["BRG-0001", "BRG-SO-001", "BRG-MV6HOGJ7"], ["KIP", "ACI"])).toEqual({
      KIP: 1,
      ACI: 1,
    });
  });
  it("formatSku selalu 3 digit", () => {
    expect(formatSku("ACI", 1)).toBe("ACI-001");
    expect(formatSku("ACI", 16)).toBe("ACI-016");
    expect(formatSku("ACI", 123)).toBe("ACI-123");
  });
});
