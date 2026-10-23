"use client";

import { useEffect, type ReactNode } from "react";
import { loadPublicConfig } from "@/lib/public-config";

export { usePublicConfig } from "@/lib/public-config";

/** Kicks off the one GET /config/public for the page. Children read it with usePublicConfig(). */
export function ConfigProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    void loadPublicConfig();
  }, []);
  return <>{children}</>;
}
