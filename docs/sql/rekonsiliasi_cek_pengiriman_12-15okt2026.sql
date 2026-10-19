-- ===============================================================================
-- REKONSILIASI (CEK — READ ONLY): Dokumen Pengiriman 12–15 OKT 2026 vs data sistem
-- ===============================================================================
-- Tujuan : membandingkan ISI CSV (data yang benar) dengan yang sudah ter-input
--          di sistem (requests + request_items), per NO TIKET + tanggal + barang
--          + kondisi aset (BARU/RETUR/UNREADY). Script ini TIDAK mengubah data.
-- Sumber : 4 file "DOKUMEN PENGIRIMAN 2026 - 12/13/14/15 OKT.csv" yang dijalankan
--          ke parser resmi sistem (src/lib/shippingUpload.ts):
--          52 tiket, 122 baris barang, total 402 unit (semuanya TERKIRIM).
--          Rinciannya ada di rekonsiliasi/HASIL-COCOKAN-12-15-OKT-2026.xlsx.
--
-- Cara pakai:
--   1. Buka https://supabase.com/dashboard -> pilih project kamu
--   2. Menu kiri: SQL Editor -> New query
--   3. Copas SELURUH isi file ini -> klik RUN (satu kali run untuk semua)
--   4. Hasilnya SATU tabel gabungan; baca kolom "bagian":
--        1_RINGKASAN                     jumlah baris per status cek
--        2_SELISIH                       baris yang TIDAK cocok (ini yang perlu diperbaiki)
--        3_TIKET_TANGGAL_BEDA            tiket CSV ada di sistem tapi tanggalnya beda
--        4_TIKET_DB_TIDAK_DI_CSV         permintaan di sistem (11–15 Okt) yang tiketnya
--                                        tidak ada di 4 CSV — info saja, TIDAK dihapus
--        5_BLOK_KURSI_LAMA               blok KURSI TRAINING tanpa tiket versi lama
--                                        (kalau ada, ikut dibersihkan script perbaiki)
--        6_BARANG_BELUM_DI_MASTER        nama barang CSV yang belum ada di master
--                                        (akan dibuat otomatis saat upload — info saja)
--        7_AKAN_DIHAPUS_OLEH_PERBAIKI    daftar PERSIS permintaan yang akan dihapus
--                                        oleh rekonsiliasi_perbaiki_...sql — CEK DULU
--                                        daftar ini sebelum menjalankan perbaikan!
--   5. Setelah perbaikan + upload ulang selesai, jalankan script ini lagi:
--      semua baris di bagian 2_SELISIH harus HILANG (status COCOK semua).
--
-- Arti status_cek:
--   COCOK                  qty diminta & terkirim di sistem == CSV
--   QTY_BEDA               total qty_requested di sistem != qty CSV
--   STATUS_KIRIM_BEDA      qty cocok tapi qty_shipped != CSV (mis. belum terkirim)
--   BELUM_ADA_DI_SISTEM    ada di CSV, belum ada di sistem (utk tiket+tanggal+barang+kondisi itu)
--   ADA_DI_SISTEM_TIDAK_DI_CSV  kebalikannya: tercatat di sistem, tidak ada di CSV
-- ===============================================================================

-- ---------------------------------------------------------------------------
-- Tabel sementara: "data yang benar menurut CSV" (hasil parser resmi)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS _rekonsiliasi_expected;
CREATE TEMP TABLE _rekonsiliasi_expected (
  ticket_no     text NOT NULL,
  request_date  date NOT NULL,
  branch_name   text,
  branch_code   text,
  item_name     text NOT NULL,   -- nama barang sesuai file
  item_key      text NOT NULL,   -- item_name huruf besar (kunci pencocokan master)
  kondisi       text NOT NULL,   -- BARU | RETUR | UNREADY
  qty_terkirim  numeric NOT NULL DEFAULT 0,
  qty_pending   numeric NOT NULL DEFAULT 0,
  barcodes      text,
  resis         text
);

INSERT INTO _rekonsiliasi_expected
  (ticket_no, request_date, branch_name, branch_code, item_name, item_key, kondisi, qty_terkirim, qty_pending, barcodes, resis)
VALUES
  ('A2610090614', '2026-10-11'::date, 'SiCepat Ekspres Jakarta Sortation', '1105056', 'SCANNER PDA', 'SCANNER PDA', 'BARU', 4, 0, '202610006935; 202610006780; 202610006860; 202610007020', '999006728135'),
  ('A2609302102', '2026-10-12'::date, 'SiCepat Ekspres Batam Sortation', '502004', 'KEYBOARD', 'KEYBOARD', 'RETUR', 6, 0, '202410003040; A1100105429; A0800067072; A0700003625; A0800045977; 20232039737', NULL),
  ('A2609302102', '2026-10-12'::date, 'SiCepat Ekspres Batam Sortation', '502004', 'KOMPUTER RAKITAN', 'KOMPUTER RAKITAN', 'RETUR', 6, 0, 'A130026153; A130026211; A130026187; A130026192; A130026151; A130026159', '999006724979; 999006724994; 999006725002; 999006725013; 999006725037; 999006725047'),
  ('A2609302102', '2026-10-12'::date, 'SiCepat Ekspres Batam Sortation', '502004', 'MONITOR', 'MONITOR', 'RETUR', 6, 0, 'A1300027473; 55859; 20232000609; A0700002706; A0800032471; A0500001498', '999006725081; 999006725091; 999006725099; 999006725108; 999006725116; 999006725129'),
  ('A2609302102', '2026-10-12'::date, 'SiCepat Ekspres Batam Sortation', '502004', 'MOUSE', 'MOUSE', 'RETUR', 6, 0, 'A1600010652; A1100011138; A0700012758; A1100012130; 202610005688; A0800152241', NULL),
  ('A2610050285', '2026-10-12'::date, 'SiCepat Ekspres Medan Sortation', '201025', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'BARU', 10, 0, '39460; 39960; 40260; 41560; 38124; 36285; 41660; 35884; 41460; 36185', '999006709744'),
  ('A2610080518', '2026-10-12'::date, 'SiCepat Ekspres Jombang Sortation', '1618003', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'BARU', 6, 0, '39660; 35985; 37924; 39560; 39760; 40160', '999006709778'),
  ('A2610080552', '2026-10-12'::date, 'Jakbar Kalideres FM', NULL, 'LAPTOP CORE I3', 'LAPTOP CORE I3', 'RETUR', 1, 0, '202610007275', '999006726296'),
  ('A2610100732', '2026-10-12'::date, 'SiCepat Ekspres Cikarang Utara FM', '1209094', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'BARU', 5, 0, '40263; 39663; 36088; 38127; 41462', '999006709809'),
  ('A2610110733', '2026-10-12'::date, 'SiCepat Ekspres Jakut Penjaringan 2 FM', '1102075', 'DVR 32 Ch', 'DVR 32 CH', 'BARU', 1, 0, '115581', '999006709822'),
  ('A2610110733', '2026-10-12'::date, 'SiCepat Ekspres Jakut Penjaringan 2 FM', '1102075', 'HARDISK 4 TB', 'HARDISK 4 TB', 'BARU', 1, 0, 'SUDAH', NULL),
  ('A2610110770', '2026-10-12'::date, 'SiCepat Ekspres Bogor Gunung Putri FM', '1223002', 'CPU RAKITAN', 'CPU RAKITAN', 'RETUR', 1, 0, 'A130026162', '999006709844'),
  ('A2610110773', '2026-10-12'::date, 'SiCepat Ekspres Denpasar Barat FM', '1701031', 'PRINTER TSC', 'PRINTER TSC', 'RETUR', 1, 0, '5548', '999006709868'),
  ('A2610110812', '2026-10-12'::date, 'SiCepat Ekspres Jakbar Cengkareng 2 FM', '1103006', 'SCANNER KABEL 2D', 'SCANNER KABEL 2D', 'RETUR', 14, 0, 'A0900010838; A0900013979; 20232020074; A0500003672; A1100037051; A1100120012; 202610002414; A1100113139; A0900014939; A0800191969; A1100034390; A1000005058; A0900013158; A0700084499', '999006724876'),
  ('A2610120806', '2026-10-12'::date, 'SiCepat Ekspres Jakbar Implant Kedoya', '1103011', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'RETUR', 1, 0, '40360', '999006709888'),
  ('A2610120808', '2026-10-12'::date, 'SiCepat Ekspres Bojonegoro Baureno', 'T1614011', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'BARU', 2, 0, '38024; 35784', '999006709932'),
  ('A2610120813', '2026-10-12'::date, 'SiCepat Ekspres Jakbar Kebon Jeruk FM', '1103069', 'SCANNER KABEL 2D', 'SCANNER KABEL 2D', 'RETUR', 30, 0, 'A0800043358; A0800200933; A1000003737; A130026817; A0900016481; A0700086666; A1100035327; 202610004956; A0900011158; A0900011155; A0900014483; 19597; A1100113771; A1100030250; A0500003273; A0900010591; A1100112420; A130024548; A1100034365; A1000003120; A1100112323; A0800051094; A0900014462; A130026834; A0800018454; A1100043214; A1100030973; A0700097464; A1100009082; A1100115203', '999006724934'),
  ('A2610120825', '2026-10-12'::date, 'SiCepat Ekspres Jaktim Cakung 2 FM', '1105064', 'RAK SERVER 6U', 'RAK SERVER 6U', 'RETUR', 1, 0, 'A130025324', 'SJ-054086'),
  ('A2610120825', '2026-10-12'::date, 'SiCepat Ekspres Jaktim Cakung 2 FM', '1105064', 'RAK SERVER 8U', 'RAK SERVER 8U', 'RETUR', 1, 0, 'A130026819', 'SJ-054086'),
  ('A2610120826', '2026-10-12'::date, 'SiCepat Ekspres Jakarta Sortation', '1105056', 'CAMERA IPEVO', 'CAMERA IPEVO', 'RETUR', 1, 0, 'A110050838', NULL),
  ('A2610120826', '2026-10-12'::date, 'SiCepat Ekspres Jakarta Sortation', '1105056', 'KEYBOARD KABEL', 'KEYBOARD KABEL', 'RETUR', 1, 0, 'A0900014276', NULL),
  ('A2610120826', '2026-10-12'::date, 'SiCepat Ekspres Jakarta Sortation', '1105056', 'KOMPUTER RAKITAN', 'KOMPUTER RAKITAN', 'RETUR', 1, 0, 'A130026196', 'DIKIRIM DRIVER BESOK'),
  ('A2610120826', '2026-10-12'::date, 'SiCepat Ekspres Jakarta Sortation', '1105056', 'MONITOR SET', 'MONITOR SET', 'RETUR', 1, 0, '20232036655', NULL),
  ('A2610120826', '2026-10-12'::date, 'SiCepat Ekspres Jakarta Sortation', '1105056', 'PRINTER TSC', 'PRINTER TSC', 'RETUR', 1, 0, '96037', NULL),
  ('A2610120826', '2026-10-12'::date, 'SiCepat Ekspres Jakarta Sortation', '1105056', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'RETUR', 1, 0, '37923', NULL),
  ('A2610120826', '2026-10-12'::date, 'SiCepat Ekspres Jakarta Sortation', '1105056', 'TIMBANGAN TOLEDO + KABEL', 'TIMBANGAN TOLEDO + KABEL', 'RETUR', 1, 0, '20232039722', NULL),
  ('A2610080540', '2026-10-13'::date, 'SiCepat Ekspres Demak LM', '1420006', 'PRINTER CANON LASERJET', 'PRINTER CANON LASERJET', 'RETUR', 1, 0, 'A1300027867', '999006738290'),
  ('A2610080540', '2026-10-13'::date, 'SiCepat Ekspres Demak LM', '1420006', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'BARU', 2, 0, '39559; 41559', '999006738321'),
  ('A2610120814', '2026-10-13'::date, 'SiCepat Ekspres Jakbar Kembangan FM', '1103082', 'SCANNER KABEL 2D', 'SCANNER KABEL 2D', 'RETUR', 22, 0, 'A0900007649; A1400004965; A0900006744; A1100065764; A1100064416; A0800095435; A1400005004; A1100043241; 18406; A1100065789; A1100034512; A1100043237; A130024737; A1100004153; A1300004419; A130026815; A1100064779; A1100043900; A1100023923; A0100000600; A0900010332; A1100043189', '999006724665'),
  ('A2610120822', '2026-10-13'::date, 'SiCepat Ekspres Bogor Sukaraja FM', '1207095', 'SCANNER KABEL 2D', 'SCANNER KABEL 2D', 'RETUR', 25, 0, 'A1100064419; A1100033821; A0900012079; A0900011186; A0800012349; A1400004962; A0700029058; A0900010609; A1100104748; A0700022174; A1100035312; A0900014472; A0800094453; A0800064202; A1100064181; A0700044306; A130026825; A0900009981; A0700030109; A1100037052; A1100064931; A1100064054; A0700044362; A0900012196; A1100029155', '999006738856'),
  ('A2610120823', '2026-10-13'::date, 'SiCepat Ekspres Bogor Citeureup FM', '1223009', 'SCANNER KABEL 2D', 'SCANNER KABEL 2D', 'BARU', 1, 0, 'A0900014471', NULL),
  ('A2610120823', '2026-10-13'::date, 'SiCepat Ekspres Bogor Citeureup FM', '1223009', 'SCANNER KABEL 2D', 'SCANNER KABEL 2D', 'RETUR', 14, 0, 'A0800094454; A0700081760; A1100046413; A0800140869; 18235; A0800217985; 39860; A1100034479; A1100060805; A0800243856; 36289; 38027; A1100034163; A0800009790', '999006738877'),
  ('A2610120827', '2026-10-13'::date, 'SiCepat Ekspres Demak FM', '1420007', 'PSU', 'PSU', 'RETUR', 1, 0, '20232044187', '999006738898'),
  ('A2610120830', '2026-10-13'::date, 'SiCepat Ekspres Cikarang Utara FM', '1209094', 'PRINTER TSC', 'PRINTER TSC', 'RETUR', 4, 0, '5631; A0800079409; A1000008571; A0700033099', '999006738917; 999006738929'),
  ('A2610120831', '2026-10-13'::date, 'SiCepat Ekspres Jakbar Tambora 1 Drop Point', 'D1103002', 'PRINTER HPRT', 'PRINTER HPRT', 'RETUR', 2, 0, '20232039347; 85532', '999006739185'),
  ('A2610120831', '2026-10-13'::date, 'SiCepat Ekspres Jakbar Tambora 1 Drop Point', 'D1103002', 'PRINTER TSC', 'PRINTER TSC', 'RETUR', 2, 0, 'A1000010016; 4293', '999006738948'),
  ('A2610120832', '2026-10-13'::date, 'SiCepat Ekspres Jakbar Kebon Jeruk LM', '1103053', 'IN AC 1 PK', 'IN AC 1 PK', 'BARU', 1, 0, '87395', NULL),
  ('A2610120832', '2026-10-13'::date, 'SiCepat Ekspres Jakbar Kebon Jeruk LM', '1103053', 'OUT AC 1 PK', 'OUT AC 1 PK', 'BARU', 1, 0, 'A130024500', '999006728186'),
  ('A2610130866', '2026-10-13'::date, 'SiCepat Ekspres Denpasar Gerokgak', 'T1706001', 'MONITOR', 'MONITOR', 'RETUR', 1, 0, 'A0800078035', '999006739233'),
  ('A2610130876', '2026-10-13'::date, 'SiCepat Ekspres Tangerang Panongan FM', '1302052', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'BARU', 2, 0, '38023; 40359', '999006738357'),
  ('A2610130878', '2026-10-13'::date, 'SiCepat Ekspres Tegal Slawi LM', '1406003', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'BARU', 1, 0, '41459', '999006738594'),
  ('A2610130880', '2026-10-13'::date, 'SiCepat Ekspres Klaten Utara LM', '1416003', 'PRINTER TSC', 'PRINTER TSC', 'RETUR', 2, 0, 'A1300030960; A1000009092', '999006739059'),
  ('A2610130880', '2026-10-13'::date, 'SiCepat Ekspres Klaten Utara LM', '1416003', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'BARU', 4, 0, '36385; 40259; 39959; 41659', '999006738631'),
  ('A2610130881', '2026-10-13'::date, 'SiCepat Ekspres Jakarta Sortation', '1105056', 'CAMERA IPEVO', 'CAMERA IPEVO', 'RETUR', 3, 0, 'A1100005223; A0800240075; 20232055880', NULL),
  ('A2610130881', '2026-10-13'::date, 'SiCepat Ekspres Jakarta Sortation', '1105056', 'KEYBOARD KABEL', 'KEYBOARD KABEL', 'RETUR', 3, 0, 'A1100046355; A0800106582; 79607', NULL),
  ('A2610130881', '2026-10-13'::date, 'SiCepat Ekspres Jakarta Sortation', '1105056', 'KOMPUTER RAKITAN', 'KOMPUTER RAKITAN', 'RETUR', 3, 0, 'A130025539; A130026169; A130026188', 'SJ-054085 (Driver :  Heri ( B 9113 PCS )'),
  ('A2610130881', '2026-10-13'::date, 'SiCepat Ekspres Jakarta Sortation', '1105056', 'MONITOR SET', 'MONITOR SET', 'RETUR', 3, 0, 'A130025507; 202610005684; A0800032441', NULL),
  ('A2610130881', '2026-10-13'::date, 'SiCepat Ekspres Jakarta Sortation', '1105056', 'MOUSE KABEL', 'MOUSE KABEL', 'RETUR', 3, 0, 'A0700001080; A0800144381; 202610006568', NULL),
  ('A2610130881', '2026-10-13'::date, 'SiCepat Ekspres Jakarta Sortation', '1105056', 'PRINTER TSC', 'PRINTER TSC', 'RETUR', 3, 0, '3844; A1300027870; A1000012171', NULL),
  ('A2610130881', '2026-10-13'::date, 'SiCepat Ekspres Jakarta Sortation', '1105056', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'RETUR', 3, 0, '36084; 53619; 50340', '999006738655'),
  ('A2610130881', '2026-10-13'::date, 'SiCepat Ekspres Jakarta Sortation', '1105056', 'TIMBANGAN TOLEDO + KABEL', 'TIMBANGAN TOLEDO + KABEL', 'RETUR', 3, 0, '86807; KJ202414644; 20220000024063', NULL),
  ('A2610130883', '2026-10-13'::date, 'SiCepat Ekspres Tangerang Tigaraksa LM', '1302084', 'MOUSE', 'MOUSE', 'RETUR', 2, 0, 'A0800152238; 202610006218', NULL),
  ('A2610130883', '2026-10-13'::date, 'SiCepat Ekspres Tangerang Tigaraksa LM', '1302084', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'BARU', 2, 0, '39659; 39759', '999006738676'),
  ('A2610130889', '2026-10-13'::date, 'SiCepat Ekspres Tangerang Sortation 1', '1302022', 'TROLLY BARANG', 'TROLLY BARANG', 'RETUR', 6, 0, '202610006208; A130026835; 20232023836; A130026828; A130026827; A130026830', '999006739375; 999006739390; 999006739407; 999006739418; 999006739435; 999006739446'),
  ('A2610130910', '2026-10-13'::date, 'SiCepat Ekspres Deli Serdang Tanjung Morawa', 'T0216002', 'DONGLE WIFI', 'DONGLE WIFI', 'BARU', 2, 0, '124331; 124334', NULL),
  ('A2610130910', '2026-10-13'::date, 'SiCepat Ekspres Deli Serdang Tanjung Morawa', 'T0216002', 'IP CAM OUTDOOR', 'IP CAM OUTDOOR', 'BARU', 3, 0, '124395; 124415; 124410', NULL),
  ('A2610130910', '2026-10-13'::date, 'SiCepat Ekspres Deli Serdang Tanjung Morawa', 'T0216002', 'KEYBOARD', 'KEYBOARD', 'RETUR', 2, 0, 'A1300025275; A1300027257', NULL),
  ('A2610130910', '2026-10-13'::date, 'SiCepat Ekspres Deli Serdang Tanjung Morawa', 'T0216002', 'KIPAS ANGIN', 'KIPAS ANGIN', 'RETUR', 2, 0, 'KJ202418564; 81092', '999006739715; 999006739726'),
  ('A2610130910', '2026-10-13'::date, 'SiCepat Ekspres Deli Serdang Tanjung Morawa', 'T0216002', 'KOMPUTER RAKITAN', 'KOMPUTER RAKITAN', 'RETUR', 2, 0, 'A130026205', '999006739608; 999006739616'),
  ('A2610130910', '2026-10-13'::date, 'SiCepat Ekspres Deli Serdang Tanjung Morawa', 'T0216002', 'MEJA', 'MEJA', 'BARU', 2, 0, '118469; 118457', '999006739569; 999006739581'),
  ('A2610130910', '2026-10-13'::date, 'SiCepat Ekspres Deli Serdang Tanjung Morawa', 'T0216002', 'MicroSD Ezviz Smart Micro SD Card 64 Gb', 'MICROSD EZVIZ SMART MICRO SD CARD 64 GB', 'BARU', 3, 0, 'SUDAH', NULL),
  ('A2610130910', '2026-10-13'::date, 'SiCepat Ekspres Deli Serdang Tanjung Morawa', 'T0216002', 'MONITOR', 'MONITOR', 'RETUR', 2, 0, '20232048413; A1300029018', '999006739631; 999006739651'),
  ('A2610130910', '2026-10-13'::date, 'SiCepat Ekspres Deli Serdang Tanjung Morawa', 'T0216002', 'MOUSE', 'MOUSE', 'RETUR', 2, 0, 'A0900008049; A0300000555', NULL),
  ('A2610130910', '2026-10-13'::date, 'SiCepat Ekspres Deli Serdang Tanjung Morawa', 'T0216002', 'PRINTER HPRT', 'PRINTER HPRT', 'RETUR', 1, 0, 'A130026816', '999006739538'),
  ('A2610130910', '2026-10-13'::date, 'SiCepat Ekspres Deli Serdang Tanjung Morawa', 'T0216002', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'BARU', 2, 0, '35783; 35883', NULL),
  ('A2610130887', '2026-10-14'::date, 'SiCepat Ekspres Cirebon Sortation', 'S1225001', 'HANDPALLET', 'HANDPALLET', 'RETUR', 3, 0, 'A130026813; A130026826; 202610003667', '999006756625; 999006756636; 999006756648'),
  ('A2610130887', '2026-10-14'::date, 'SiCepat Ekspres Cirebon Sortation', 'S1225001', 'PALLET PLASTIK', 'PALLET PLASTIK', 'RETUR', 8, 0, 'A130026833; A130026818; A130026821; A130026822; A130026823; A130026829; A130026836; A130026851', '999006756693; 999006756695; 999006756699; 999006756703; 999006756709; 999006756715; 999006756721; 999006756733'),
  ('A2610130890', '2026-10-14'::date, 'SiCepat Ekspres Bogor Tanah Sereal LM', '1207001', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'BARU', 3, 0, '40059; 39459; 39859', '999006738777'),
  ('A2610130899', '2026-10-14'::date, 'SiCepat Ekspres Bandung Dayeuhkolot FM', '1201159', 'PRINTER TSC', 'PRINTER TSC', 'RETUR', 2, 0, '97072; 57415', '999006739101'),
  ('A2610130899', '2026-10-14'::date, 'SiCepat Ekspres Bandung Dayeuhkolot FM', '1201159', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'BARU', 2, 0, '38123; 40159', '999006738800'),
  ('A2610130904', '2026-10-14'::date, 'SiCepat Ekspres Padang Sortation 2', 'S0302001', 'PRINTER TSC', 'PRINTER TSC', 'RETUR', 1, 0, 'A1100113574', '999006758326'),
  ('A2610140946', '2026-10-14'::date, 'SiCepat Ekspres Bogor Depok Sortation', 'S1223001', 'CAMERA IPEVO', 'CAMERA IPEVO', 'RETUR', 1, 0, '20232000841', NULL),
  ('A2610140946', '2026-10-14'::date, 'SiCepat Ekspres Bogor Depok Sortation', 'S1223001', 'KEYBOARD', 'KEYBOARD', 'RETUR', 1, 0, 'A1300013139', NULL),
  ('A2610140946', '2026-10-14'::date, 'SiCepat Ekspres Bogor Depok Sortation', 'S1223001', 'KOMPUTER RAKITAN', 'KOMPUTER RAKITAN', 'RETUR', 1, 0, 'A130026145', '999006739755'),
  ('A2610140946', '2026-10-14'::date, 'SiCepat Ekspres Bogor Depok Sortation', 'S1223001', 'MONITOR', 'MONITOR', 'RETUR', 1, 0, 'A0800067205', '999006739773'),
  ('A2610140946', '2026-10-14'::date, 'SiCepat Ekspres Bogor Depok Sortation', 'S1223001', 'PRINTER TSC', 'PRINTER TSC', 'RETUR', 1, 0, 'A1100118051', '999006739911'),
  ('A2610140946', '2026-10-14'::date, 'SiCepat Ekspres Bogor Depok Sortation', 'S1223001', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'BARU', 1, 0, '37922', '999006739809'),
  ('A2610140946', '2026-10-14'::date, 'SiCepat Ekspres Bogor Depok Sortation', 'S1223001', 'TIMBANGAN TOLEDO + KABEL', 'TIMBANGAN TOLEDO + KABEL', 'RETUR', 1, 0, 'A1000005634', '999006739836'),
  ('A2610140947', '2026-10-14'::date, 'SiCepat Ekspres Jakarta Kalideres Sortation', 'S1103001', 'CAMERA IPEVO', 'CAMERA IPEVO', 'RETUR', 1, 0, '202610006552', NULL),
  ('A2610140947', '2026-10-14'::date, 'SiCepat Ekspres Jakarta Kalideres Sortation', 'S1103001', 'KEYBOARD', 'KEYBOARD', 'RETUR', 1, 0, 'A1300013139', NULL),
  ('A2610140947', '2026-10-14'::date, 'SiCepat Ekspres Jakarta Kalideres Sortation', 'S1103001', 'KOMPUTER RAKITAN', 'KOMPUTER RAKITAN', 'RETUR', 1, 0, 'A130026176', '999006739956'),
  ('A2610140947', '2026-10-14'::date, 'SiCepat Ekspres Jakarta Kalideres Sortation', 'S1103001', 'MONITOR', 'MONITOR', 'RETUR', 1, 0, 'A1600009655', '999006739982'),
  ('A2610140947', '2026-10-14'::date, 'SiCepat Ekspres Jakarta Kalideres Sortation', 'S1103001', 'PRINTER TSC', 'PRINTER TSC', 'RETUR', 1, 0, 'A130026831', '999006740020'),
  ('A2610140947', '2026-10-14'::date, 'SiCepat Ekspres Jakarta Kalideres Sortation', 'S1103001', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'RETUR', 1, 0, '28129', '999006740005'),
  ('A2610140947', '2026-10-14'::date, 'SiCepat Ekspres Jakarta Kalideres Sortation', 'S1103001', 'TIMBANGAN TOLEDO + KABEL', 'TIMBANGAN TOLEDO + KABEL', 'RETUR', 1, 0, 'A0700054332', '999006740071'),
  ('HLDP-BATCH2-14102026', '2026-10-14'::date, 'Semarang Sortation (HLDP Batch 2)', NULL, 'KURSI TRAINING', 'KURSI TRAINING', 'RETUR', 23, 0, '20240004782; 20240004797; 20240004792; 20240004755; 20240004772; 20240004794; 20240004793; 20240004795; 20240004778; 20240004754; 20240004768; 20240004779; A1100118417; 20240004789; 20240004783; 20240004773; 20240004801; 20240004786; 20240004784; 20240004775; 20240004761; 20240004757; 20240004781', '999006742866; 999006742858; 999006742855; 999006742851; 999006742842; 999006742838; 999006742830; 999006742825; 999006742822; 999006742812; 999006742801; 999006742790; 999006742782; 999006742778; 999006742774; 999006742767; 999006742763; 999006742759; 999006742753; 999006742744; 999006742735; 999006742716; 999006742708'),
  ('A2610120810', '2026-10-15'::date, 'SiCepat Ekspres Depok Cimanggis FM', '1208040', 'KEYBOARD', 'KEYBOARD', 'RETUR', 2, 0, 'A0900003875; 20232039346', NULL),
  ('A2610120810', '2026-10-15'::date, 'SiCepat Ekspres Depok Cimanggis FM', '1208040', 'KOMPUTER RAKITAN', 'KOMPUTER RAKITAN', 'RETUR', 2, 0, 'A1300028105; A1100121045', '999006756563; 999006756574'),
  ('A2610120810', '2026-10-15'::date, 'SiCepat Ekspres Depok Cimanggis FM', '1208040', 'MONITOR', 'MONITOR', 'RETUR', 2, 0, 'KJ202416694; A0700102147', '999006756584; 999006756588'),
  ('A2610120810', '2026-10-15'::date, 'SiCepat Ekspres Depok Cimanggis FM', '1208040', 'MOUSE', 'MOUSE', 'RETUR', 2, 0, '20232043593; 57681', NULL),
  ('A2610120810', '2026-10-15'::date, 'SiCepat Ekspres Depok Cimanggis FM', '1208040', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'RETUR', 3, 0, '38122; 39758; 52001', '999006756601'),
  ('A2610130901', '2026-10-15'::date, 'SiCepat Ekspres Jaksel Kebayoran Lama FM', '1104006', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'RETUR', 11, 0, '33569; 39958; 39458; 29583; 30277; 40358; 28035; 36284; 56053; 39558; 40158', '999006758040'),
  ('A2610130908', '2026-10-15'::date, 'SiCepat Ekspres Jaksel Kebayoran Lama FM', '1104006', 'CPU RAKITAN', 'CPU RAKITAN', 'RETUR', 1, 0, 'A1300027426', '999006757975'),
  ('A2610140945', '2026-10-15'::date, 'SiCepat Ekspres Bogor Jonggol LM', '1207018', 'MEJA', 'MEJA', 'BARU', 2, 0, '118474; A1300030022', '999006758351; 999006758358'),
  ('A2610140945', '2026-10-15'::date, 'SiCepat Ekspres Bogor Jonggol LM', '1207018', 'MOUSE', 'MOUSE', 'BARU', 1, 0, '202610005824', NULL),
  ('A2610140945', '2026-10-15'::date, 'SiCepat Ekspres Bogor Jonggol LM', '1207018', 'MOUSE', 'MOUSE', 'RETUR', 2, 0, '202610005821; A0700091001', '999006758384'),
  ('A2610140956', '2026-10-15'::date, 'SiCepat Ekspres Purbalingga Kartanegara', 'T1429004', 'DONGLE WIFI', 'DONGLE WIFI', 'BARU', 2, 0, '124322; 124313', NULL),
  ('A2610140956', '2026-10-15'::date, 'SiCepat Ekspres Purbalingga Kartanegara', 'T1429004', 'IP CAM OUTDOOR', 'IP CAM OUTDOOR', 'BARU', 2, 0, '124386; 124412', NULL),
  ('A2610140956', '2026-10-15'::date, 'SiCepat Ekspres Purbalingga Kartanegara', 'T1429004', 'KEYBOARD', 'KEYBOARD', 'RETUR', 2, 0, 'A0700000847; A0800032903', NULL),
  ('A2610140956', '2026-10-15'::date, 'SiCepat Ekspres Purbalingga Kartanegara', 'T1429004', 'KOMPUTER RAKITAN', 'KOMPUTER RAKITAN', 'RETUR', 2, 0, '202610003182; 82770', '999006756880; 999006756895'),
  ('A2610140956', '2026-10-15'::date, 'SiCepat Ekspres Purbalingga Kartanegara', 'T1429004', 'MEJA', 'MEJA', 'BARU', 1, 0, '118468', '999006756971'),
  ('A2610140956', '2026-10-15'::date, 'SiCepat Ekspres Purbalingga Kartanegara', 'T1429004', 'MicroSD Ezviz Smart Micro SD Card 64 Gb', 'MICROSD EZVIZ SMART MICRO SD CARD 64 GB', 'BARU', 2, 0, 'SUDAH', NULL),
  ('A2610140956', '2026-10-15'::date, 'SiCepat Ekspres Purbalingga Kartanegara', 'T1429004', 'MONITOR', 'MONITOR', 'RETUR', 2, 0, 'A1100009252; 20232039359', '999006756914; 999006756932'),
  ('A2610140956', '2026-10-15'::date, 'SiCepat Ekspres Purbalingga Kartanegara', 'T1429004', 'MOUSE', 'MOUSE', 'RETUR', 2, 0, 'A0800111943; A0800035234', NULL),
  ('A2610140956', '2026-10-15'::date, 'SiCepat Ekspres Purbalingga Kartanegara', 'T1429004', 'PRINTER HPRT', 'PRINTER HPRT', 'RETUR', 2, 0, '11844; A1100002399', '999006756952'),
  ('A2610140956', '2026-10-15'::date, 'SiCepat Ekspres Purbalingga Kartanegara', 'T1429004', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'RETUR', 2, 0, '35984; 31590', NULL),
  ('A2610140957', '2026-10-15'::date, 'SiCepat Ekspres Bogor Cigombong LM', '1207022', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'RETUR', 2, 0, '47528; 34139', '999006758098'),
  ('A2610140958', '2026-10-15'::date, 'SiCepat Ekspres Lamongan Sukomulyo', 'T1605025', 'DONGLE WIFI', 'DONGLE WIFI', 'BARU', 3, 0, '124328; 124290; 124325', NULL),
  ('A2610140958', '2026-10-15'::date, 'SiCepat Ekspres Lamongan Sukomulyo', 'T1605025', 'IP CAM OUTDOOR', 'IP CAM OUTDOOR', 'BARU', 3, 0, '124371; 124360; 124384', NULL),
  ('A2610140958', '2026-10-15'::date, 'SiCepat Ekspres Lamongan Sukomulyo', 'T1605025', 'MicroSD Ezviz Smart Micro SD Card 64 Gb', 'MICROSD EZVIZ SMART MICRO SD CARD 64 GB', 'BARU', 3, 0, 'SUDAH', NULL),
  ('A2610140958', '2026-10-15'::date, 'SiCepat Ekspres Lamongan Sukomulyo', 'T1605025', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'RETUR', 2, 0, '41658; 36384', '999006757739'),
  ('A2610140964', '2026-10-15'::date, 'SiCepat Ekspres Demak LM', '1420006', 'CPU RAKITAN', 'CPU RAKITAN', 'RETUR', 1, 0, '88454', '999006758009'),
  ('A2610140965', '2026-10-15'::date, 'SiCepat Ekspres Bogor Selatan LM', '1207025', 'CAMERA CCTV INDOOR', 'CAMERA CCTV INDOOR', 'RETUR', 1, 0, '202610003533', NULL),
  ('A2610140965', '2026-10-15'::date, 'SiCepat Ekspres Bogor Selatan LM', '1207025', 'CAMERA CCTV OUTDOOR', 'CAMERA CCTV OUTDOOR', 'RETUR', 21, 0, '202610006072; 202610006087; 202610006108; 202610006126; 202610006084; 202610006115; 202610006074; A130026854; 202610006125; 202610006128; A0700002859; 202610006076; 202610006520; 202610006483; A0700002864; 202610006427; 202610006433; 202610006437; 202610006428; 202610005769; A130026852', '999006757792'),
  ('A2610140965', '2026-10-15'::date, 'SiCepat Ekspres Bogor Selatan LM', '1207025', 'DVR 32 Ch', 'DVR 32 CH', 'BARU', 1, 0, '124343', '999006757830'),
  ('A2610140965', '2026-10-15'::date, 'SiCepat Ekspres Bogor Selatan LM', '1207025', 'HARDISK 4 TB', 'HARDISK 4 TB', 'BARU', 1, 0, 'SUDAH', NULL),
  ('A2610140965', '2026-10-15'::date, 'SiCepat Ekspres Bogor Selatan LM', '1207025', 'PSU', 'PSU', 'RETUR', 2, 0, 'A1300027807; A0800032395', '999006757903'),
  ('A2610140968', '2026-10-15'::date, 'SiCepat Ekspres Cirebon Palimanan LM', '1225004', 'CPU RAKITAN', 'CPU RAKITAN', 'RETUR', 1, 0, 'A0800035969', '999006757923'),
  ('A2610140969', '2026-10-15'::date, 'SiCepat Ekspres Jaksel Pesanggrahan LM', '1104037', 'CPU RAKITAN', 'CPU RAKITAN', 'RETUR', 1, 0, '8408', '999006757948'),
  ('A2610140970', '2026-10-15'::date, 'SiCepat Ekspres Sleman Depok LM', '1502007', 'SCANNER WIRELESS', 'SCANNER WIRELESS', 'RETUR', 2, 0, '39858; 36389', '999006758142'),
  ('A2610140971', '2026-10-15'::date, 'Keagenan SiCepat Gorontalo Kota Selatan LM', 'A3001006', 'TIMBANGAN TOLEDO + KABEL', 'TIMBANGAN TOLEDO + KABEL', 'RETUR', 1, 0, 'A130024333', '999006758231'),
  ('A2610140973', '2026-10-15'::date, 'SiCepat Ekspres Tangerang Balaraja FM', '1302101', 'PRINTER TSC', 'PRINTER TSC', 'RETUR', 1, 0, 'A1300027892', '999006758268');

-- ---------------------------------------------------------------------------
-- Agregasi data sistem saat ini utk tiket-tiket CSV (semua request dgn tiket itu)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS _rekonsiliasi_aktual;
CREATE TEMP TABLE _rekonsiliasi_aktual AS
SELECT
  upper(btrim(r.ticket_no)) AS ticket_no,
  r.request_date,
  upper(btrim(ii.name))     AS item_key,
  CASE
          WHEN upper(COALESCE(ri.status_aset, '')) LIKE '%RETUR%'
            OR upper(COALESCE(ri.status_aset, '')) LIKE '%RETURN%' THEN 'RETUR'
          WHEN upper(COALESCE(ri.status_aset, '')) LIKE '%UNREADY%' THEN 'UNREADY'
          ELSE 'BARU'
        END AS kondisi,
  SUM(ri.qty_requested)     AS qty_requested,
  SUM(ri.qty_shipped)       AS qty_shipped,
  COUNT(DISTINCT r.id)      AS jml_request,
  string_agg(DISTINCT r.request_number, ', ') AS request_numbers
FROM public.requests r
JOIN public.request_items ri   ON ri.request_id = r.id
JOIN public.inventory_items ii ON ii.id = ri.item_id
WHERE upper(btrim(r.ticket_no)) IN (SELECT DISTINCT ticket_no FROM _rekonsiliasi_expected)
GROUP BY 1, 2, 3, 4;

-- ---------------------------------------------------------------------------
-- Hasil cocokan per tiket+tanggal+barang+kondisi
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS _rekonsiliasi_hasil;
CREATE TEMP TABLE _rekonsiliasi_hasil AS
SELECT
  COALESCE(e.ticket_no, a.ticket_no)       AS ticket_no,
  COALESCE(e.request_date, a.request_date) AS request_date,
  e.branch_name,
  COALESCE(e.item_name, a.item_key)        AS item_name,
  COALESCE(e.kondisi, a.kondisi)           AS kondisi,
  COALESCE(e.qty_terkirim, 0) + COALESCE(e.qty_pending, 0) AS qty_csv,
  e.qty_terkirim                           AS qty_csv_terkirim,
  a.qty_requested                          AS qty_sistem_diminta,
  a.qty_shipped                            AS qty_sistem_terkirim,
  a.jml_request,
  a.request_numbers,
  CASE
    WHEN a.ticket_no IS NULL THEN 'BELUM_ADA_DI_SISTEM'
    WHEN e.ticket_no IS NULL THEN 'ADA_DI_SISTEM_TIDAK_DI_CSV'
    WHEN a.qty_requested <> e.qty_terkirim + e.qty_pending THEN 'QTY_BEDA'
    WHEN a.qty_shipped   <> e.qty_terkirim THEN 'STATUS_KIRIM_BEDA'
    ELSE 'COCOK'
  END AS status_cek
FROM _rekonsiliasi_expected e
FULL JOIN _rekonsiliasi_aktual a
  ON a.ticket_no = e.ticket_no
 AND a.request_date = e.request_date
 AND a.item_key = e.item_key
 AND a.kondisi = e.kondisi;

-- ---------------------------------------------------------------------------
-- LAPORAN GABUNGAN (satu tabel hasil — urut per bagian)
-- ---------------------------------------------------------------------------
SELECT bagian, status_cek, ticket_no, request_date, branch_name, item_name, kondisi,
       qty_csv, qty_sistem_diminta, qty_sistem_terkirim, request_numbers, keterangan
FROM (
  -- 1) RINGKASAN
  SELECT '1_RINGKASAN' AS bagian, status_cek,
         NULL::text AS ticket_no, NULL::date AS request_date, NULL::text AS branch_name,
         NULL::text AS item_name, NULL::text AS kondisi,
         NULL::numeric AS qty_csv, NULL::numeric AS qty_sistem_diminta, NULL::numeric AS qty_sistem_terkirim,
         NULL::text AS request_numbers,
         COUNT(*)::text || ' baris (tiket×barang×kondisi)' AS keterangan,
         1 AS urut
    FROM _rekonsiliasi_hasil
   GROUP BY status_cek

  UNION ALL
  -- 2) SELISIH (yang bukan COCOK)
  SELECT '2_SELISIH', status_cek, ticket_no, request_date, branch_name, item_name, kondisi,
         qty_csv, qty_sistem_diminta, qty_sistem_terkirim, request_numbers,
         CASE status_cek
           WHEN 'QTY_BEDA' THEN 'qty sistem ' || qty_sistem_diminta || ' vs CSV ' || qty_csv
           WHEN 'STATUS_KIRIM_BEDA' THEN 'terkirim di sistem ' || qty_sistem_terkirim || ' vs CSV ' || qty_csv_terkirim
           WHEN 'BELUM_ADA_DI_SISTEM' THEN 'belum ter-input utk tiket+tanggal+barang+kondisi ini'
           WHEN 'ADA_DI_SISTEM_TIDAK_DI_CSV' THEN 'tercatat di sistem tapi tidak ada di CSV (cek juga bagian 3: mungkin tanggalnya bergeser)'
           ELSE ''
         END,
         2
    FROM _rekonsiliasi_hasil
   WHERE status_cek <> 'COCOK'

  UNION ALL
  -- 3) Tiket CSV yang di sistem TANGGAL-nya beda (petunjuk tanggal bergeser)
  SELECT '3_TIKET_TANGGAL_BEDA', 'TANGGAL_BEDA', e.ticket_no, e.tanggal_sistem_min, NULL, NULL, NULL,
         NULL, NULL, NULL, e.request_numbers,
         'menurut CSV tanggal ' || e.tanggal_csv || ', di sistem tercatat tanggal: ' || e.tanggal_sistem,
         3
    FROM (
      SELECT e2.ticket_no,
             string_agg(DISTINCT e2.request_date::text, ', ') AS tanggal_csv,
             string_agg(DISTINCT a2.request_date::text, ', ') AS tanggal_sistem,
             MIN(a2.request_date) AS tanggal_sistem_min,
             string_agg(DISTINCT a2.request_numbers, ', ')   AS request_numbers
        FROM (SELECT DISTINCT ticket_no, request_date FROM _rekonsiliasi_expected) e2
        JOIN _rekonsiliasi_aktual a2
          ON a2.ticket_no = e2.ticket_no AND a2.request_date <> e2.request_date
       GROUP BY e2.ticket_no
    ) e

  UNION ALL
  -- 4) Permintaan di sistem tgl 11–15 Okt 2026 yang tiketnya TIDAK ada di CSV (info)
  SELECT '4_TIKET_DB_TIDAK_DI_CSV', 'INFO_SAJA', upper(btrim(r.ticket_no)), r.request_date, r.branch_name,
         COUNT(ri.id)::text || ' baris barang', NULL,
         NULL, SUM(ri.qty_requested), SUM(ri.qty_shipped), r.request_number,
         'status permintaan: ' || r.status || ' — tidak disentuh script perbaiki (kecuali blok KURSI, lihat bagian 5)',
         4
    FROM public.requests r
    JOIN public.request_items ri ON ri.request_id = r.id
   WHERE r.request_date BETWEEN DATE '2026-10-11' AND DATE '2026-10-15'
     AND upper(btrim(r.ticket_no)) NOT IN (SELECT DISTINCT ticket_no FROM _rekonsiliasi_expected)
   GROUP BY r.id, r.ticket_no, r.request_date, r.branch_name, r.request_number, r.status

  UNION ALL
  -- 5) Blok KURSI TRAINING tanpa tiket versi lama (dicari lewat barcode fisiknya)
  SELECT '5_BLOK_KURSI_LAMA', 'AKAN_DIBERSIHKAN', upper(btrim(r.ticket_no)), r.request_date, r.branch_name,
         'KURSI TRAINING', NULL,
         23, SUM(ri.qty_requested), SUM(ri.qty_shipped), r.request_number,
         'qty benar menurut CSV = 23 (bila di sini 45, itu bug parser lama). Ikut dihapus script perbaiki lalu masuk lagi dari upload ulang sbg tiket HLDP-BATCH2-14102026.',
         5
    FROM public.requests r
    JOIN public.request_items ri ON ri.request_id = r.id
   WHERE EXISTS (SELECT 1 FROM public.request_items x
                  WHERE x.request_id = r.id AND x.barcode LIKE '%20240004782%')
   GROUP BY r.id, r.ticket_no, r.request_date, r.branch_name, r.request_number

  UNION ALL
  -- 6) Nama barang CSV yang belum ada di master barang (info)
  SELECT '6_BARANG_BELUM_DI_MASTER', 'INFO_SAJA', NULL, NULL, NULL, e.item_name, NULL,
         SUM(e.qty_terkirim + e.qty_pending), NULL, NULL, NULL,
         'belum ada di inventory_items — akan dibuat otomatis saat upload. Cek ejaannya supaya tidak jadi barang dobel.',
         6
    FROM _rekonsiliasi_expected e
   WHERE NOT EXISTS (SELECT 1 FROM public.inventory_items ii WHERE upper(btrim(ii.name)) = e.item_key)
   GROUP BY e.item_name

  UNION ALL
  -- 7) Daftar PERSIS yang akan dihapus script PERBAIKI
  SELECT '7_AKAN_DIHAPUS_OLEH_PERBAIKI', 'TARGET_HAPUS', upper(btrim(r.ticket_no)), r.request_date, r.branch_name,
         COUNT(ri.id)::text || ' baris barang', NULL,
         NULL, SUM(ri.qty_requested), SUM(ri.qty_shipped), r.request_number,
         'status: ' || r.status || ' — akan dihapus lalu dibuat ulang dari CSV saat upload ulang. Stoknya dipulihkan dulu oleh trigger purge.',
         7
    FROM public.requests r
    JOIN public.request_items ri ON ri.request_id = r.id
   WHERE upper(btrim(r.ticket_no)) IN (SELECT DISTINCT ticket_no FROM _rekonsiliasi_expected)
      OR EXISTS (SELECT 1 FROM public.request_items x
                  WHERE x.request_id = r.id AND x.barcode LIKE '%20240004782%')
   GROUP BY r.id, r.ticket_no, r.request_date, r.branch_name, r.request_number, r.status
) laporan
ORDER BY urut, ticket_no, request_date, item_name;
