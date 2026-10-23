"use client";

import { createContext, useContext } from "react";

export interface AuthState {
  mode: "dev" | "clerk";
  /** False until we know whether the person is signed in (storage read or Clerk loaded). */
  ready: boolean;
  signedIn: boolean;
  email: string | null;
  signOut: () => void | Promise<void>;
}

export const AuthContext = createContext<AuthState>({
  mode: "dev",
  ready: false,
  signedIn: false,
  email: null,
  signOut: () => {},
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
