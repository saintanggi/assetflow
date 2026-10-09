import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ClipboardList, Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
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
  email: z.string().min(1, "Email wajib diisi").email("Masukkan alamat email yang valid"),
  password: z.string().min(1, "Kata sandi wajib diisi"),
});

type LoginForm = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { user, loading: authLoading, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

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
    const { error } = await signIn(data.email, data.password);
    if (error) {
      setFormError("Email atau kata sandi salah");
      return;
    }
    navigate(from, { replace: true });
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] bg-slate-50">
      {/* Panel kiri — branding navy */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-navy-950 p-10 text-white lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(52,103,163,0.4),transparent_65%)]"
        />
        <div className="relative flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20">
            <ClipboardList className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold">AssetFlow</span>
        </div>
        <div className="relative">
          <h2 className="text-3xl font-bold leading-snug">
            Kelola aset &amp; gudang dengan percaya diri.
          </h2>
          <p className="mt-4 max-w-md text-slate-300">
            Pencatatan aset tetap, persediaan, dan transaksi dalam satu sistem yang
            akurat, transparan, dan siap diaudit.
          </p>
        </div>
        <p className="relative text-xs text-slate-500">
          © {new Date().getFullYear()} AssetFlow — Sistem Informasi Manajemen Aset &amp; Gudang
        </p>
      </div>

      {/* Panel kanan — form */}
      <div className="flex w-full items-center justify-center px-4 py-12 lg:w-1/2">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="space-y-1">
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-navy-900 lg:hidden">
              <ClipboardList className="h-5 w-5 text-white" />
            </div>
            <CardTitle className="text-2xl">Masuk ke AssetFlow</CardTitle>
            <CardDescription>
              Gunakan akun staf Anda untuk mengakses dashboard operasional.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                  <p className="text-xs text-red-600">{errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Kata sandi</Label>
                  <Link
                    to="/lupa-password"
                    className="text-xs font-medium text-brand-600 hover:underline"
                  >
                    Lupa kata sandi?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="pr-10"
                    {...register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-xs text-red-600">{errors.password.message}</p>
                )}
              </div>
              {formError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formError}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Masuk
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-slate-500">
              Belum punya akun? Hubungi administrator sistem Anda.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
