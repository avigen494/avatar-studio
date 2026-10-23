import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ConfigProvider } from "@/components/auth/ConfigProvider";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Avatar Studio", template: "%s · Avatar Studio" },
  description: "Make talking-head videos of yourself from your phone. Charged only when a video succeeds.",
  applicationName: "Avatar Studio",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1013" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">
        <ConfigProvider>
          <ToastProvider>{children}</ToastProvider>
        </ConfigProvider>
      </body>
    </html>
  );
}
