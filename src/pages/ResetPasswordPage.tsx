import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  KeyRound,
  Loader2,
} from "lucide-react";
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

const schema = z
  .object({
    password: z.string().min(6, "Password minimal 6 karakter"),
    confirm: z.string().min(1, "Konfirmasi password wajib diisi"),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Konfirmasi password tidak sama",
    path: ["confirm"],
  });

type ResetForm = z.infer<typeof schema>;

/**
 * Halaman tujuan tautan reset password dari email.
 * Supabase menukar ?code=... menjadi sesi recovery secara otomatis saat
 * client diinisialisasi (detectSessionInUrl); halaman ini menunggu sesi
 * tersebut lalu memanggil updateUser.
 */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetForm>({ resolver: zodResolver(schema) });

  useEffect(() => {
    let cancelled = false;

    const waitForSession = async () => {
      for (let i = 0; i < 20; i++) {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          setHasSession(true);
          setChecking(false);
          return;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      if (!cancelled) setChecking(false);
    };
    void waitForSession();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY") {
        setHasSession(true);
        setChecking(false);
      } else if (event === "SIGNED_OUT") {
        setHasSession(false);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(data: ResetForm) {
    setError(null);
    const { error: updError } = await supabase.auth.updateUser({
      password: data.password,
    });
    if (updError) {
      setError(
        "Gagal memperbarui kata sandi. Tautan mungkin kedaluwarsa — minta tautan baru di halaman lupa kata sandi."
      );
      return;
    }
    await supabase.auth.signOut();
    setDone(true);
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-slate-50 px-4 py-12">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-1">
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-navy-900">
            <KeyRound className="h-5 w-5 text-white" />
          </div>
          <CardTitle className="text-2xl">Atur kata sandi baru</CardTitle>
          <CardDescription>
            Masukkan kata sandi baru untuk akun Anda.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {checking ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Memverifikasi tautan reset…
            </div>
          ) : done ? (
            <div className="flex flex-col items-center py-4 text-center">
              <div className="rounded-full bg-green-100 p-4">
                <CheckCircle2 className="h-8 w-8 text-green-700" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-800">
                Kata sandi berhasil diperbarui
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                Silakan masuk kembali dengan kata sandi baru Anda.
              </p>
              <Button
                className="mt-6 w-full"
                onClick={() => navigate("/login", { replace: true })}
              >
                Ke halaman masuk
              </Button>
            </div>
          ) : !hasSession ? (
            <div className="flex flex-col items-center py-4 text-center">
              <div className="rounded-full bg-amber-100 p-4">
                <ClipboardList className="h-8 w-8 text-amber-700" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-800">
                Tautan tidak valid atau kedaluwarsa
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                Buka kembali tautan terbaru dari email Anda, atau minta tautan
                baru di halaman lupa kata sandi.
              </p>
              <Link
                to="/lupa-password"
                className="mt-6 inline-flex h-10 w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                Minta tautan baru
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="password">Kata sandi baru</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Minimal 6 karakter"
                  {...register("password")}
                />
                {errors.password && (
                  <p className="text-xs text-red-600">{errors.password.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Konfirmasi kata sandi baru</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Ketik ulang kata sandi baru"
                  {...register("confirm")}
                />
                {errors.confirm && (
                  <p className="text-xs text-red-600">{errors.confirm.message}</p>
                )}
              </div>
              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Simpan kata sandi baru
              </Button>
            </form>
          )}
          {!done && (
            <Link
              to="/login"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
            >
              <ArrowLeft className="h-4 w-4" />
              Kembali ke halaman masuk
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
