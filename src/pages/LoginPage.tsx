import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

const loginSchema = z.object({
  username: z.string().min(1, "Username wajib diisi"),
  password: z.string().min(1, "Kata sandi wajib diisi"),
});

type LoginForm = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { user, loading: authLoading, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  // MFA: setelah password benar, akun dengan MFA aktif harus verifikasi kode.
  const [mfaNeeded, setMfaNeeded] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaChallengeId, setMfaChallengeId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);

  const from = (location.state as { from?: string } | undefined)?.from ?? "/dashboard";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  if (!authLoading && user) {
    return <Navigate to={from} replace />;
  }

  async function onSubmit(data: LoginForm) {
    setFormError(null);
    const rawInput = data.username.trim();
    const uname = rawInput.toLowerCase();
    let email = rawInput;

    if (!uname.includes("@")) {
      const { data: resolved, error: rpcErr } = await supabase.rpc(
        "resolve_login_email",
        { p_username: uname }
      );
      if (!rpcErr && typeof resolved === "string" && resolved) {
        email = resolved;
      } else {
        email = `${uname}@inventory.internal`;
      }
    }

    const { error } = await signIn(email, data.password);
    if (error) {
      setFormError("Username atau kata sandi salah");
      return;
    }
    // Cek apakah akun ini wajib MFA (aal1 → aal2).
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel === "aal1") {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = factors?.totp?.find((f) => f.status === "verified");
      if (verified) {
        const ch = await supabase.auth.mfa.challenge({ factorId: verified.id });
        if (!ch.error && ch.data) {
          setMfaFactorId(verified.id);
          setMfaChallengeId(ch.data.id);
          setMfaNeeded(true);
          return;
        }
      }
      setFormError("Akun ini memakai MFA, tapi verifikasi tidak bisa dimulai. Coba lagi.");
      return;
    }
    navigate(from, { replace: true });
  }

  async function onMfaSubmit() {
    if (!mfaFactorId || !mfaChallengeId || mfaCode.trim().length !== 6) {
      setFormError("Masukkan kode 6 digit dari aplikasi authenticator.");
      return;
    }
    setMfaBusy(true);
    setFormError(null);
    const { error } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: mfaChallengeId,
      code: mfaCode.trim(),
    });
    setMfaBusy(false);
    if (error) {
      setFormError("Kode MFA salah atau kedaluwarsa. Coba lagi.");
      return;
    }
    navigate(from, { replace: true });
  }

  return (
    <div className="relative flex min-h-[calc(100vh-4rem)] overflow-hidden bg-ink-800 bg-[radial-gradient(1000px_480px_at_85%_-10%,rgba(245,158,11,0.14),transparent),radial-gradient(800px_480px_at_0%_110%,rgba(59,130,246,0.12),transparent)]">
      {/* Orbs latar — sama seperti dashboard & katalog publik */}
      <div
        aria-hidden
        className="animate-drift pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-warn-500/10 blur-3xl"
      />
      <div
        aria-hidden
        className="animate-drift-slow pointer-events-none absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-info-500/10 blur-3xl"
      />
      {/* Lingkaran melayang — gaya animasi video login (balon putih lembut) */}
      <div
        aria-hidden
        className="animate-float-slow pointer-events-none absolute left-[6%] top-[10%] h-24 w-24 rounded-full bg-white/[0.06] blur-xl"
        style={{ animationDelay: "-3s" }}
      />
      <div
        aria-hidden
        className="animate-float-slow pointer-events-none absolute bottom-[12%] right-[8%] h-32 w-32 rounded-full bg-white/[0.05] blur-2xl"
        style={{ animationDelay: "-8s" }}
      />
      <div
        aria-hidden
        className="animate-float-slow pointer-events-none absolute right-[36%] top-[64%] h-16 w-16 rounded-full bg-info-500/10 blur-xl"
        style={{ animationDelay: "-11s" }}
      />

      {/* Panel kiri — branding */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden border-r border-white/10 bg-white/[0.04] p-12 lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 shadow-soft">
            <span className="font-display text-sm font-extrabold text-white">IW</span>
          </div>
          <div>
            <p className="font-display text-lg font-bold leading-tight text-white">
              Inventory Warehouse
            </p>
            <p className="text-xs uppercase tracking-widest text-brand-200">
              Command Center
            </p>
          </div>
        </div>
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1 text-xs font-medium text-white">
            <ShieldCheck className="h-3.5 w-3.5 text-brand-200" />
            Sistem terpadu aset & gudang
          </div>
          <h2 className="font-display text-4xl font-bold leading-tight tracking-tight text-white">
            Operasional gudang,
            <br />
            dalam satu kendali.
          </h2>
          <p className="mt-4 max-w-md text-ink-300">
            Pencatatan aset tetap, persediaan, dan transaksi dalam satu command
            center yang akurat, transparan, dan siap diaudit.
          </p>
          <div className="mt-8 grid max-w-md grid-cols-3 gap-3">
            {[
              ["Real-time", "Stok & transaksi"],
              ["Audit-ready", "Jejak tercatat"],
              ["Aman", "Kontrol akses peran"],
            ].map(([t, d]) => (
              <div
                key={t}
                className="rounded-xl border border-white/15 bg-white/[0.07] p-3"
              >
                <p className="font-display text-sm font-bold text-brand-200">{t}</p>
                <p className="mt-1 text-xs text-ink-300">{d}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-ink-300">
          © {new Date().getFullYear()} Inventory Warehouse — Sistem Informasi Manajemen Aset &amp; Gudang
        </p>
      </div>

      {/* Panel kanan — form */}
      <div className="relative flex w-full items-center justify-center px-4 py-12 lg:w-1/2">
        <Card className="animate-login-in w-full max-w-md shadow-card">
          <CardHeader className="space-y-1">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 shadow-soft lg:hidden">
              <span className="font-display text-base font-extrabold text-white">IW</span>
            </div>
            <CardTitle className="font-display text-2xl text-ink-800">Selamat datang kembali</CardTitle>
            <CardDescription>
              Masuk untuk mengakses command center operasional.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="space-y-2">
                <div className="relative">
                  <Input
                    id="username"
                    type="text"
                    autoComplete="username"
                    placeholder=" "
                    {...register("username")}
                    className="peer h-14 rounded-full border-ink-200 bg-ink-100/70 px-5 pb-2 pt-6 focus-visible:border-info-500 focus-visible:ring-info-500/40"
                  />
                  <Label
                    htmlFor="username"
                    className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-sm font-normal text-ink-500 transition-all duration-200 peer-focus:top-2.5 peer-focus:translate-y-0 peer-focus:text-[11px] peer-focus:font-semibold peer-focus:text-info-600 peer-[:not(:placeholder-shown)]:top-2.5 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:font-semibold"
                  >
                    Username
                  </Label>
                </div>
                {errors.username && (
                  <p className="text-xs text-brand-600">{errors.username.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder=" "
                    className="peer h-14 rounded-full border-ink-200 bg-ink-100/70 px-5 pb-2 pr-12 pt-6 focus-visible:border-info-500 focus-visible:ring-info-500/40"
                    {...register("password")}
                  />
                  <Label
                    htmlFor="password"
                    className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-sm font-normal text-ink-500 transition-all duration-200 peer-focus:top-2.5 peer-focus:translate-y-0 peer-focus:text-[11px] peer-focus:font-semibold peer-focus:text-info-600 peer-[:not(:placeholder-shown)]:top-2.5 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:font-semibold"
                  >
                    Kata sandi
                  </Label>
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-700"
                    aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="flex justify-end">
                  <Link
                    to="/lupa-password"
                    className="text-xs font-medium text-brand-700 hover:text-brand-700"
                  >
                    Lupa kata sandi?
                  </Link>
                </div>
                {errors.password && (
                  <p className="text-xs text-brand-600">{errors.password.message}</p>
                )}
              </div>
              {formError && (
                <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-600">
                  {formError}
                </p>
              )}
              {mfaNeeded ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="mfa-code">Kode Authenticator (6 digit)</Label>
                    <Input
                      id="mfa-code"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="123456"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                      autoFocus
                    />
                    <p className="text-xs text-ink-500">
                      Password benar. Masukkan kode dari aplikasi authenticator Anda.
                    </p>
                  </div>
                  <Button type="button" className="w-full" disabled={mfaBusy} onClick={() => void onMfaSubmit()}>
                    {mfaBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                    Verifikasi & Masuk
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => {
                      setMfaNeeded(false);
                      setMfaCode("");
                    }}
                  >
                    Kembali
                  </Button>
                </div>
              ) : (
                <Button
                  type="submit"
                  className="h-12 w-full rounded-full bg-white text-base font-semibold text-info-700 shadow-soft ring-1 ring-info-500/30 transition-all duration-300 hover:bg-gradient-to-r hover:from-info-500 hover:to-info-600 hover:text-white hover:ring-info-600/40 focus-visible:ring-info-500"
                  disabled={isSubmitting}
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Masuk ke Command Center
                </Button>
              )}
            </form>
            <p className="mt-6 text-center text-sm text-ink-500">
              Belum punya akun? Hubungi administrator sistem Anda.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
