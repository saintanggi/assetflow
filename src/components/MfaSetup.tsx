import { useEffect, useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/**
 * MFA (TOTP) — aktifkan / nonaktifkan autentikasi dua faktor untuk akun sendiri.
 * Memakai Supabase Auth MFA: enroll → scan QR di aplikasi authenticator
 * (Google Authenticator / Authy) → verifikasi kode 6 digit.
 */
export function MfaSetup() {
  const [loading, setLoading] = useState(true);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const loadFactors = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw new Error(error.message);
      const verified = data?.totp?.find((f) => f.status === "verified");
      setFactorId(verified?.id ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat status MFA");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFactors();
  }, []);

  const startEnroll = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error || !data) throw new Error(error?.message ?? "Gagal memulai enroll MFA");
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setEnrolling(true);
      // Challenge untuk verifikasi kode pertama.
      const ch = await supabase.auth.mfa.challenge({ factorId: data.id });
      if (!ch.error && ch.data) setChallengeId(ch.data.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memulai enroll MFA");
    } finally {
      setBusy(false);
    }
  };

  const verifyEnroll = async () => {
    if (!factorId || !challengeId || code.trim().length !== 6) {
      toast.error("Masukkan kode 6 digit dari aplikasi authenticator.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code: code.trim(),
      });
      if (error) throw new Error(error.message);
      toast.success("MFA aktif! Mulai sekarang login butuh kode authenticator.");
      setEnrolling(false);
      setQrCode(null);
      setSecret(null);
      setCode("");
      await loadFactors();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kode salah, coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  const unenroll = async () => {
    if (!factorId) return;
    if (!window.confirm("Nonaktifkan MFA? Akun ini kembali hanya pakai password.")) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw new Error(error.message);
      toast.success("MFA dinonaktifkan.");
      setFactorId(null);
      await loadFactors();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menonaktifkan MFA");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-ink-300">Memuat status MFA…</p>;

  if (factorId && !enrolling) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-ok-100" />
          <div>
            <p className="text-sm font-medium text-white">MFA aktif (TOTP)</p>
            <p className="text-xs text-ink-300">Login membutuhkan kode dari aplikasi authenticator.</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={unenroll}
          className="border-white/20 bg-white/10 text-white hover:border-white/25 hover:bg-white/15 hover:text-white"
        >
          <ShieldOff className="mr-1.5 h-4 w-4" /> Nonaktifkan
        </Button>
      </div>
    );
  }

  if (enrolling && qrCode) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-300">
          Scan QR ini dengan Google Authenticator / Authy, lalu masukkan kode 6 digit yang muncul.
        </p>
        <div className="flex flex-wrap items-start gap-4">
          {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
          <img src={qrCode} alt="QR kode MFA" className="h-40 w-40 rounded-lg border border-ink-200 bg-white p-1" />
          <div className="min-w-48 flex-1 space-y-2">
            {secret && (
              <div>
                <Label className="text-ink-100">Kode rahasia (kalau tidak bisa scan)</Label>
                <Input
                  readOnly
                  value={secret}
                  className="border-white/15 bg-white/10 font-mono text-xs text-white placeholder:text-ink-300"
                />
              </div>
            )}
            <div>
              <Label className="text-ink-100">Kode 6 digit dari authenticator</Label>
              <Input
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
              />
            </div>
            <div className="flex gap-2">
              <Button disabled={busy} onClick={verifyEnroll}>
                {busy ? "Memverifikasi…" : "Verifikasi & Aktifkan"}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setEnrolling(false);
                  setQrCode(null);
                  setSecret(null);
                  setCode("");
                }}
                className="border-white/20 bg-white/10 text-white hover:border-white/25 hover:bg-white/15 hover:text-white"
              >
                Batal
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-white">MFA belum aktif</p>
        <p className="text-xs text-ink-300">
          Tambahkan lapisan kedua: login butuh kode dari aplikasi authenticator di HP.
        </p>
      </div>
      <Button disabled={busy} onClick={startEnroll}>
        <ShieldCheck className="mr-1.5 h-4 w-4" /> Aktifkan MFA
      </Button>
    </div>
  );
}
