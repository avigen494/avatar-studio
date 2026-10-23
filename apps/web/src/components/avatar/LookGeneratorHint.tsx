"use client";

import Link from "next/link";
import { useIsAdmin } from "@/lib/admin";
import { usePublicConfig } from "@/lib/public-config";

/** Whether new looks come from fal.ai (true) or the colour-grade-and-crop mock (false). */
export function useLookGenerator(): { real: boolean; isAdmin: boolean } {
  const { config } = usePublicConfig();
  const admin = useIsAdmin();
  return { real: config.look_generator, isAdmin: admin.isAdmin };
}

/** One line under the generate buttons when only the mock is available. */
export function LookGeneratorHint({ className = "" }: { className?: string }) {
  const { real, isAdmin } = useLookGenerator();
  if (real) return null;
  return (
    <p className={`text-xs text-muted ${className}`}>
      {isAdmin ? (
        <>
          <Link href="/settings/connections" className="font-semibold text-accent">
            Connect fal.ai in Settings → Connections
          </Link>{" "}
          for real new looks. Until then the results only change the colour grade and crop.
        </>
      ) : (
        "Connect fal.ai in Settings → Connections for real new looks. Until then the results only change the colour grade and crop."
      )}
    </p>
  );
}
