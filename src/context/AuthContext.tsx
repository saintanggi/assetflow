import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Profile } from "../types/database";

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  permissions: string[];
  loading: boolean;
  isSuperAdmin: boolean;
  isStaff: boolean;
  hasPermission: (code: string) => boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadPermissions(userId: string, roleId: string | null): Promise<string[]> {
  const set = new Set<string>();
  if (roleId) {
    const { data } = await supabase
      .from("role_permissions")
      .select("permissions(code)")
      .eq("role_id", roleId);
    for (const row of data ?? []) {
      const code = (row.permissions as unknown as { code: string } | null)?.code;
      if (code) set.add(code);
    }
  }
  const { data: overrides } = await supabase
    .from("user_permissions")
    .select("granted, permissions(code)")
    .eq("user_id", userId);
  for (const row of overrides ?? []) {
    const code = (row.permissions as unknown as { code: string } | null)?.code;
    if (!code) continue;
    if (row.granted) set.add(code);
    else set.delete(code);
  }
  return [...set];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (u: User | null) => {
    if (!u) {
      setProfile(null);
      setPermissions([]);
      return;
    }
    // Cek akun operasional (username) dulu.
    const { data: acc } = await supabase
      .from("user_accounts")
      .select("username, role, display_name, is_active")
      .eq("auth_user_id", u.id)
      .maybeSingle();
    if (acc && (acc as { is_active: boolean }).is_active) {
      const a = acc as { username: string; role: string; display_name: string };
      // Bangun profile sintetis dari user_accounts.
      const roleName = a.role;
      setProfile({
        id: u.id,
        email: `${a.username}@inventory.internal`,
        full_name: a.display_name,
        display_name: a.display_name,
        roles: { name: roleName },
        is_active: true,
      } as unknown as typeof profile);
      // Permissions berdasarkan role operasional (sinkron dengan has_permission() di DB).
      const rolePerms: Record<string, string[]> = {
        super_admin: ["*"],
        admin_ho: [
          "requests.view",
          "requests.create",
          "inventory.view",
          "reports.view",
        ],
        admin_gudang: [
          "requests.view",
          "requests.create",
          "requests.review",
          "requests.approve",
          "inventory.view",
          "inventory.receive",
          "inventory.issue",
          "inventory.transfer",
          "inventory.adjust",
          "labels.print",
          "reports.view",
          "reports.export",
        ],
        helper: [
          "requests.view",
          "requests.process",
          "inventory.view",
          "labels.print",
        ],
      };
      setPermissions(rolePerms[roleName] ?? []);
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("*, roles(name)")
      .eq("id", u.id)
      .single();
    if (error || !data) {
      setProfile(null);
      setPermissions([]);
      return;
    }
    const p = data as Profile;
    if (!p.is_active) {
      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
      setPermissions([]);
      return;
    }
    setProfile(p);
    setPermissions(await loadPermissions(u.id, p.role_id));
  }, []);

  const refreshProfile = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await loadProfile(session?.user ?? null);
  }, [loadProfile]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!mounted) return;
      setUser(session?.user ?? null);
      await loadProfile(session?.user ?? null);
      if (mounted) setLoading(false);
    })();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null);
      await loadProfile(session?.user ?? null);
      setLoading(false);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setPermissions([]);
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const roleName = profile?.roles?.name;
    const isSuperAdmin = roleName === "super_admin";
    const isStaff =
      !!profile?.is_active &&
      (roleName === "super_admin" ||
        roleName === "admin" ||
        roleName === "admin_ho" ||
        roleName === "admin_gudang" ||
        roleName === "helper");
    return {
      user,
      profile,
      permissions,
      loading,
      isSuperAdmin,
      isStaff,
      // Super Admin selalu lolos semua permission (cerminan has_permission() di DB).
      // Jangan pernah baca role dari localStorage — identitas dari Supabase Auth + DB.
      hasPermission: (code: string) =>
        isSuperAdmin || permissions.includes("*") || permissions.includes(code),
      signIn,
      signOut,
      refreshProfile,
    };
  }, [user, profile, permissions, loading, signIn, signOut, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam <AuthProvider>");
  return ctx;
}
