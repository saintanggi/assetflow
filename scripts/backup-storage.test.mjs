import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  backupStorage,
  encodeStoragePath,
  listAllFilesInBucket,
  resolveSafeLocalPath,
} from "./backup-storage.mjs";

test("encodeStoragePath meng-encode setiap segmen path tanpa merusak slash", () => {
  assert.equal(
    encodeStoragePath("surat-jalan/2026-11/SJ 001+baru.jpg"),
    "surat-jalan/2026-11/SJ%20001%2Bbaru.jpg"
  );
});

test("resolveSafeLocalPath menolak path traversal atau karakter nol", () => {
  assert.throws(() => resolveSafeLocalPath("/tmp/backup", "../etc/passwd"), /tidak aman/i);
  assert.throws(() => resolveSafeLocalPath("/tmp/backup", "a/../../b"), /tidak aman/i);
  assert.throws(() => resolveSafeLocalPath("/tmp/backup", "bad\0name.png"), /tidak aman/i);

  const safe = resolveSafeLocalPath("/tmp/backup", "2026/11/foto.png");
  assert.equal(safe, path.resolve("/tmp/backup", "2026", "11", "foto.png"));
});

test("listAllFilesInBucket memaginasi >1000 item, menelusuri subfolder, dan melewati placeholder", async () => {
  const firstPage = Array.from({ length: 1000 }, (_, i) => ({
    id: `id-${i}`,
    name: `file-${String(i).padStart(4, "0")}.jpg`,
    updated_at: "2026-11-26T00:00:00Z",
    metadata: { size: 100, mimetype: "image/jpeg" },
  }));
  const secondPage = [
    { id: null, name: "nested", updated_at: null, metadata: null },
    { id: "id-ph", name: ".emptyFolderPlaceholder", updated_at: "2026-11-26T00:00:00Z", metadata: { size: 0 } },
    { id: "id-1000", name: "file-1000.jpg", updated_at: "2026-11-26T00:00:00Z", metadata: { size: 250, mimetype: "image/jpeg" } },
  ];
  const nestedPage = [
    { id: "id-nested", name: "surat.pdf", updated_at: "2026-11-26T00:00:00Z", metadata: { size: 512, mimetype: "application/pdf" } },
  ];

  const calls = [];
  const mockFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ prefix: body.prefix, offset: body.offset });
    if (body.prefix === "" && body.offset === 0) return new Response(JSON.stringify(firstPage), { status: 200 });
    if (body.prefix === "" && body.offset === 1000) return new Response(JSON.stringify(secondPage), { status: 200 });
    if (body.prefix === "nested" && body.offset === 0) return new Response(JSON.stringify(nestedPage), { status: 200 });
    return new Response("[]", { status: 200 });
  };

  const files = await listAllFilesInBucket({
    supabaseUrl: "https://example.supabase.co",
    serviceKey: "service-role",
    bucketId: "surat-jalan",
    fetchFn: mockFetch,
  });

  assert.equal(files.length, 1002);
  assert.equal(files[0].path, "file-0000.jpg");
  assert.equal(files.some((f) => f.path === "nested/surat.pdf"), true);
  assert.equal(files.some((f) => f.path === "file-1000.jpg"), true);
  assert.equal(calls.length, 3);
});

test("backupStorage mengunduh semua bucket (termasuk retry HTTP 503) dan membuat storage-manifest.json", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "assetflow-storage-test-"));
  try {
    let downloadAttempts = 0;
    const mockFetch = async (url, init) => {
      if (url.endsWith("/storage/v1/bucket") && init.method === "GET") {
        return new Response(
          JSON.stringify([
            { id: "surat-jalan", name: "surat-jalan", public: false },
            { id: "asset-photos", name: "asset-photos", public: true },
          ]),
          { status: 200 }
        );
      }

      if (url.includes("/storage/v1/object/list/surat-jalan")) {
        return new Response(
          JSON.stringify([
            { id: "1", name: "sj 1.jpg", updated_at: "2026-11-26T00:00:00Z", metadata: { size: 9, mimetype: "image/jpeg" } },
          ]),
          { status: 200 }
        );
      }

      if (url.includes("/storage/v1/object/list/asset-photos")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url.endsWith("/storage/v1/object/surat-jalan/sj%201.jpg")) {
        downloadAttempts += 1;
        if (downloadAttempts === 1) {
          return new Response("temporary", { status: 503 });
        }
        return new Response(Buffer.from("JPEGDATA!"), { status: 200 });
      }

      return new Response("not found", { status: 404 });
    };

    const manifest = await backupStorage({
      supabaseUrl: "https://example.supabase.co/",
      serviceKey: "secret-key",
      outDir: tmpDir,
      fetchFn: mockFetch,
    });

    assert.equal(downloadAttempts, 2);
    assert.equal(manifest.total_buckets, 2);
    assert.equal(manifest.total_files, 1);
    assert.equal(manifest.total_bytes, 9);

    const savedFile = await readFile(path.join(tmpDir, "surat-jalan", "sj 1.jpg"), "utf8");
    assert.equal(savedFile, "JPEGDATA!");

    const savedManifest = JSON.parse(await readFile(path.join(tmpDir, "storage-manifest.json"), "utf8"));
    assert.equal(savedManifest.total_files, 1);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
