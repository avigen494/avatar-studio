"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/** Renders a QR code for `text`. The encoder loads only when this mounts (desktop widths). */
export function QrCode({ text, size = 160, label }: { text: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("qrcode")
      .then((mod) => mod.toDataURL(text, { margin: 1, width: size * 2, errorCorrectionLevel: "M" }))
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [text, size]);

  return (
    <div className="relative overflow-hidden rounded-xl bg-white p-2" style={{ width: size + 16, height: size + 16 }}>
      {src ? (
        <Image src={src} alt={label} width={size} height={size} unoptimized />
      ) : (
        <div className="skeleton h-full w-full" aria-label={label} role="img" />
      )}
    </div>
  );
}
