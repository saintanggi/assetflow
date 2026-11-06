// Bunyi navigasi lembut — Web Audio API, tanpa file audio eksternal.
// Dipakai AppLayout: satu bunyi "klik" tiap pindah menu/dashboard.

const STORAGE_KEY = "assetflow-nav-sound";

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

/**
 * Dipanggil saat interaksi pertama (klik/sentuh) supaya AudioContext boleh
 * bunyi — browser memblokir audio sebelum ada gestur pengguna.
 */
export function unlockAudio(): void {
  if (!isNavSoundEnabled()) return;
  const c = getContext();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
}

export function isNavSoundEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setNavSoundEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* penyimpanan tidak tersedia — suara tetap nyala */
  }
}

/**
 * Bunyi "klik" lembut (nada turun 740 → 520 Hz, ~90 mdtk, pelan).
 * Diam kalau suara dimatikan atau audio belum dibuka gestur pengguna.
 */
export function playNavSound(): void {
  if (!isNavSoundEnabled()) return;
  const c = getContext();
  if (!c || c.state !== "running") return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(740, t);
  osc.frequency.exponentialRampToValueAtTime(520, t + 0.07);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.06, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}
