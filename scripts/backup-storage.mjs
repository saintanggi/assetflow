#!/usr/bin/env node
/**
 * Backup seluruh file di Supabase Storage (semua bucket) ke direktori lokal.
 * Tanpa dependensi eksternal — memakai built-in fetch Node.js 20+/22+.
 *
 * Contoh pakai:
 *   SUPABASE_URL="https://xxx.supabase.co" \
 *   SUPABASE_SERVICE_ROLE_KEY="..." \
 *   node scripts/backup-storage.mjs --out ./backup/storage
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PAGE_SIZE = 1000;
const MAX_RETRIES = 3;

export function encodeStoragePath(objectPath) {
  return String(objectPath)
    .split("/")
    .filter((seg) => seg.length > 0)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export function resolveSafeLocalPath(rootDir, relativePath) {
  const root = path.resolve(rootDir);
  const cleaned = String(relativePath)
    .replaceAll("\\", "/")
    .split("/")
    .filter((seg) => seg.length > 0 && seg !== ".");

  if (cleaned.length === 0 || cleaned.some((seg) => seg === ".." || seg.includes("\0"))) {
    throw new Error(`Path objek Storage tidak aman: ${relativePath}`);
  }

  const target = path.resolve(root, ...cleaned);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path objek keluar dari direktori tujuan: ${relativePath}`);
  }
  return target;
}

async function fetchWithRetry(fetchFn, url, init, label) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchFn(url, init);
      if (res.ok) return res;
      const body = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status >= 500;
      const err = new Error(`${label} gagal (HTTP ${res.status}): ${body.slice(0, 300)}`);
      if (!retryable || attempt === MAX_RETRIES) throw err;
      lastErr = err;
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES) throw err;
    }
    await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  throw lastErr;
}

export async function listBuckets({ supabaseUrl, serviceKey, fetchFn = fetch }) {
  const baseUrl = supabaseUrl.replace(/\/+$/, "");
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };
  const res = await fetchWithRetry(
    fetchFn,
    `${baseUrl}/storage/v1/bucket`,
    { method: "GET", headers },
    "Daftar bucket Storage"
  );
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Respons daftar bucket Storage bukan array JSON");
  }
  return data;
}

export async function listAllFilesInBucket({
  supabaseUrl,
  serviceKey,
  bucketId,
  fetchFn = fetch,
}) {
  const baseUrl = supabaseUrl.replace(/\/+$/, "");
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const files = [];

  async function walk(prefix) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const res = await fetchWithRetry(
        fetchFn,
        `${baseUrl}/storage/v1/object/list/${encodeURIComponent(bucketId)}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            prefix,
            limit: PAGE_SIZE,
            offset,
            sortBy: { column: "name", order: "asc" },
          }),
        },
        `Daftar objek ${bucketId}/${prefix}`
      );
      const entries = await res.json();
      if (!Array.isArray(entries)) {
        throw new Error(`Respons list objek ${bucketId} bukan array JSON`);
      }

      for (const entry of entries) {
        const name = entry?.name;
        if (!name || name === ".emptyFolderPlaceholder") continue;
        const fullPath = prefix ? `${prefix}/${name}` : name;

        // Di API Storage Supabase, folder memiliki id === null.
        if (entry.id === null || entry.id === undefined) {
          await walk(fullPath);
        } else {
          files.push({
            path: fullPath,
            size: Number(entry?.metadata?.size ?? 0) || 0,
            mimetype: entry?.metadata?.mimetype ?? null,
            updated_at: entry?.updated_at ?? null,
          });
        }
      }

      if (entries.length < PAGE_SIZE) break;
    }
  }

  await walk("");
  return files;
}

export async function backupStorage({
  supabaseUrl,
  serviceKey,
  outDir,
  fetchFn = fetch,
}) {
  if (!supabaseUrl) throw new Error("SUPABASE_URL wajib diisi");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY wajib diisi");
  if (!outDir) throw new Error("Direktori tujuan (--out) wajib diisi");

  const baseUrl = supabaseUrl.replace(/\/+$/, "");
  const authHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };

  await mkdir(outDir, { recursive: true });
  const buckets = await listBuckets({ supabaseUrl: baseUrl, serviceKey, fetchFn });

  const bucketReports = [];
  let totalFiles = 0;
  let totalBytes = 0;

  for (const bucket of buckets) {
    const bucketId = bucket.id || bucket.name;
    const bucketDir = resolveSafeLocalPath(outDir, bucketId);
    await mkdir(bucketDir, { recursive: true });

    const files = await listAllFilesInBucket({
      supabaseUrl: baseUrl,
      serviceKey,
      bucketId,
      fetchFn,
    });

    let bucketBytes = 0;
    for (const file of files) {
      const encoded = encodeStoragePath(`${bucketId}/${file.path}`);
      const res = await fetchWithRetry(
        fetchFn,
        `${baseUrl}/storage/v1/object/${encoded}`,
        { method: "GET", headers: authHeaders },
        `Unduh ${bucketId}/${file.path}`
      );
      const buf = Buffer.from(await res.arrayBuffer());
      const dest = resolveSafeLocalPath(bucketDir, file.path);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      bucketBytes += buf.byteLength;
    }

    totalFiles += files.length;
    totalBytes += bucketBytes;
    bucketReports.push({
      id: bucketId,
      public: Boolean(bucket.public),
      files: files.length,
      bytes: bucketBytes,
      objects: files,
    });
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    total_buckets: bucketReports.length,
    total_files: totalFiles,
    total_bytes: totalBytes,
    buckets: bucketReports,
  };

  await writeFile(
    path.join(outDir, "storage-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  return manifest;
}

function parseOutArg(argv) {
  const idx = argv.indexOf("--out");
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return process.env.BACKUP_STORAGE_DIR || "./storage-backup";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outDir = parseOutArg(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  backupStorage({ supabaseUrl, serviceKey, outDir })
    .then((manifest) => {
      console.log(
        `Storage backup selesai: ${manifest.total_buckets} bucket, ${manifest.total_files} file, ${manifest.total_bytes} byte`
      );
    })
    .catch((err) => {
      console.error(`ERROR backup-storage: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
