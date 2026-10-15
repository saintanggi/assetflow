import { Navigate, useLocation } from "react-router-dom";
import type { ReactElement } from "react";
import { useAuth } from "../context/AuthContext";

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 shadow-soft">
          <span className="font-display text-xs font-extrabold text-white">IW</span>
        </div>
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-200 border-t-brand-600" />
        <p className="text-sm text-ink-500">Memuat…</p>
      </div>
    </div>
  );
}

/** Wajib login. */
export function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

/** Wajib login + punya permission (super_admin selalu lolos). */
export function RequirePermission({
  code,
  children,
}: {
  code: string;
  children: ReactElement;
}) {
  const { user, loading, hasPermission } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!hasPermission(code)) return <Navigate to="/403" replace />;
  return children;
}

/** Khusus Super Admin. */
export function RequireSuperAdmin({ children }: { children: ReactElement }) {
  const { user, loading, isSuperAdmin } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!isSuperAdmin) return <Navigate to="/403" replace />;
  return children;
}
