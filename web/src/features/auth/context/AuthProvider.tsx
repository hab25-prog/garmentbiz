import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  getAuthenticatedProfile,
  login as loginWithApi,
  logout as logoutWithApi,
  refreshAccessToken,
  register as registerWithApi,
} from "../api/auth.api";
import type {
  AuthenticatedProfile,
  AuthenticatedSession,
  LoginInput,
  RegistrationAcceptedResponse,
  RegisterInput,
} from "../types/auth.types";
import { clearAccessToken } from "../../../lib/access-token";
import { useLanguage } from "../../../app/providers/LanguageProvider";

export type AuthenticationStatus = "initializing" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthenticationStatus;
  user: AuthenticatedProfile["user"] | null;
  membership: AuthenticatedProfile["membership"] | null;
  isAuthenticated: boolean;
  login(input: LoginInput): Promise<AuthenticatedSession>;
  register(input: RegisterInput): Promise<RegistrationAcceptedResponse>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
// eslint-disable-next-line react-refresh/only-export-components
export const authSessionQueryKey = ["auth-session"] as const;

async function restoreSession(): Promise<AuthenticatedProfile | null> {
  try {
    await refreshAccessToken();
    return await getAuthenticatedProfile();
  } catch {
    clearAccessToken();
    return null;
  }
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { setLanguage } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loggedOut, setLoggedOut] = useState(false);
  const sessionQuery = useQuery({
    queryKey: authSessionQueryKey,
    queryFn: restoreSession,
    enabled: !loggedOut,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const profile = sessionQuery.data ?? null;
  useEffect(() => {
    if (profile?.user.language) setLanguage(profile.user.language);
  }, [profile?.user.language, setLanguage]);
  const status: AuthenticationStatus = sessionQuery.isPending && !loggedOut
    ? "initializing"
    : profile
      ? "authenticated"
      : "unauthenticated";

  const acceptSession = useCallback((session: AuthenticatedSession) => {
    setLoggedOut(false);
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== authSessionQueryKey[0] });
    queryClient.setQueryData<AuthenticatedProfile>(authSessionQueryKey, {
      user: session.user,
      membership: session.membership,
    });
    navigate("/app", { replace: true });
    return session;
  }, [navigate, queryClient]);

  const login = useCallback(async (input: LoginInput) => {
    const session = await loginWithApi(input);
    return acceptSession(session);
  }, [acceptSession]);

  const register = useCallback(async (input: RegisterInput) => {
    return registerWithApi(input);
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutWithApi();
    } finally {
      clearAccessToken();
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== authSessionQueryKey[0] });
      queryClient.setQueryData<AuthenticatedProfile | null>(authSessionQueryKey, null);
      setLoggedOut(true);
      navigate("/login", { replace: true });
    }
  }, [navigate, queryClient]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user: profile?.user ?? null,
    membership: profile?.membership ?? null,
    isAuthenticated: status === "authenticated",
    login,
    register,
    logout,
  }), [login, logout, profile, register, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
