import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  // Jangan crash saat build; runtime akan gagal jelas bila env belum diisi.
  console.warn(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY belum diisi. Salin .env.example menjadi .env lalu isi nilainya."
  );
}

export const supabase = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseAnonKey ?? "placeholder-anon-key"
);

/** Basis URL aplikasi untuk QR code publik, mis. https://assetflow.vercel.app */
export const APP_URL =
  (import.meta.env.VITE_APP_URL as string | undefined)?.replace(/\/$/, "") ??
  (typeof window !== "undefined" ? window.location.origin : "");

/** URL detail publik sebuah aset (yang di-encode ke QR code). */
export function publicAssetUrl(publicCode: string): string {
  return `${APP_URL}/publik/aset/${encodeURIComponent(publicCode)}`;
}
