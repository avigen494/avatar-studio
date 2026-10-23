"use client";

import { createContext, useContext } from "react";
import type { MeOut } from "./types";

export interface MeState {
  me: MeOut | undefined;
  loading: boolean;
  error: unknown;
  /**
   * True once the first GET /me has answered (or failed). Other requests wait
   * for it: the API creates the account and workspace on the first request,
   * so firing several in parallel for a brand-new user is not safe.
   */
  bootstrapped: boolean;
  refetch: () => void;
  setMe: (updater: MeOut | undefined | ((prev: MeOut | undefined) => MeOut | undefined)) => void;
}

export const MeContext = createContext<MeState>({
  me: undefined,
  loading: true,
  error: undefined,
  bootstrapped: true,
  refetch: () => {},
  setMe: () => {},
});

export function useMe(): MeState {
  return useContext(MeContext);
}
