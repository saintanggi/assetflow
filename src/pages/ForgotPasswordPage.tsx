import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
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

const schema = z.object({
  email: z.string().min(1, "Email wajib diisi").email("Masukkan alamat email yang valid"),
});

type ForgotForm = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotForm>({ resolver: zodResolver(schema) });

  async function onSubmit(data: ForgotForm) {
    setError(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (resetError) {
      setError("Gagal mengirim tautan reset. Coba lagi beberapa saat.");
      return;
    }
    setSent(true);
  }

  return (
    <div className="relative flex min-h-[calc(100vh-4rem)] items-center justify-center overflow-hidden bg-ink-800 bg-[radial-gradient(1000px_480px_at_85%_-10%,rgba(245,158,11,0.14),transparent),radial-gradient(800px_480px_at_0%_110%,rgba(59,130,246,0.12),transparent)] px-4 py-12">
      {/* Orbs latar — sama seperti dashboard & halaman login */}
      <div
        aria-hidden
        className="animate-drift pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-warn-500/10 blur-3xl"
      />
      <div
        aria-hidden
        className="animate-drift-slow pointer-events-none absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-info-500/10 blur-3xl"
      />
      <Card className="relative w-full max-w-md shadow-card">
        <CardHeader className="space-y-1">
          <img
            src="/favicon.svg"
            alt="Logo Inventory Warehouse"
            className="mb-2 h-11 w-11 rounded-xl shadow-soft"
          />
          <CardTitle className="font-display text-2xl text-ink-800">Lupa kata sandi</CardTitle>
          <CardDescription>
            Masukkan email akun Anda — kami akan mengirimkan tautan untuk mengatur ulang
            kata sandi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="flex flex-col items-center py-4 text-center">
              <div className="rounded-full bg-brand-50 p-4 ring-1 ring-brand-600/20">
                <MailCheck className="h-8 w-8 text-brand-700" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-ink-800">
                Tautan reset telah dikirim
              </h3>
              <p className="mt-2 text-sm text-ink-500">
                Jika email tersebut terdaftar, Anda akan menerima tautan pengaturan ulang
                kata sandi dalam beberapa menit. Periksa juga folder spam Anda.
              </p>
              <Link
                to="/login"
                className="mt-6 inline-flex h-10 w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-brand-700"
              >
                Kembali ke halaman masuk
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="nama@perusahaan.id"
                  {...register("email")}
                />
                {errors.email && (
                  <p className="text-xs text-brand-600">{errors.email.message}</p>
                )}
              </div>
              {error && (
                <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-600">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Kirim tautan reset
              </Button>
            </form>
          )}
          <Link
            to="/login"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Kembali ke halaman masuk
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
