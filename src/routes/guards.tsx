import { Navigate, useLocation } from "react-router-dom";
import type { ReactElement } from "react";
import { useAuth } from "../context/AuthContext";

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50">
      <div className="flex flex-col items-center gap-3">
        <img
          src="/favicon.svg"
          alt="Logo Inventory Warehouse"
          className="h-10 w-10 rounded-lg shadow-soft"
        />
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-200 border-t-brand-600" />
        <p className="text-sm text-ink-500">Memuat…</p>
      </div>
    </div>
  );
}

/** Wajib login (dan MFA terverifikasi jika akun mengaktifkan MFA). */
export function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading, mfaRequired } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (!user || mfaRequired) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

/** Wajib login + MFA terverifikasi + punya permission (super_admin selalu lolos). */
export function RequirePermission({
  code,
  children,
}: {
  code: string;
  children: ReactElement;
}) {
  const { user, loading, mfaRequired, hasPermission } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (!user || mfaRequired) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!hasPermission(code)) return <Navigate to="/403" replace />;
  return children;
}

/** Khusus Super Admin (wajib MFA terverifikasi jika aktif). */
export function RequireSuperAdmin({ children }: { children: ReactElement }) {
  const { user, loading, mfaRequired, isSuperAdmin } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (!user || mfaRequired) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!isSuperAdmin) return <Navigate to="/403" replace />;
  return children;
}
