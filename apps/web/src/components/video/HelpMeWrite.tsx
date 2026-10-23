"use client";

import Link from "next/link";
import { useIsAdmin } from "@/lib/admin";
import { usePublicConfig } from "@/lib/public-config";

/** Whether "Help me write" can run right now (Claude connected on the server). */
export function useScriptHelper(): { enabled: boolean; isAdmin: boolean } {
  const { config } = usePublicConfig();
  const admin = useIsAdmin();
  return { enabled: config.script_helper, isAdmin: admin.isAdmin };
}

/** One-line hint shown under the chips when the helper is off. */
export function ScriptHelperHint() {
  const { enabled, isAdmin } = useScriptHelper();
  if (enabled) return null;
  return (
    <p className="text-xs text-muted">
      {isAdmin ? (
        <>
          Help me write is off.{" "}
          <Link href="/settings/connections" className="font-semibold text-accent">
            Connect Claude in Settings → Connections
          </Link>{" "}
          to turn it on.
        </>
      ) : (
        "Help me write is off. Connect Claude in Settings → Connections to turn this on (platform admin only)."
      )}
    </p>
  );
}
