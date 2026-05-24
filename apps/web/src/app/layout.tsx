import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/shell/ServiceWorkerRegister";
import { InstallPrompt } from "@/components/shell/InstallPrompt";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Hybrid Training",
  description: "Train hybrid. One plan, two modalities, zero collisions.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Hybrid",
    statusBarStyle: "black-translucent",
  },
  icons: {
    // 180×180, full-bleed (no transparency, no pre-rounded corners) — iOS
    // applies its own mask. Source: scripts/generate-icons.mjs.
    apple: "/icons/apple-touch-icon.png",
  },
  other: {
    // Next.js 15's `appleWebApp.capable: true` emits the modern
    // `mobile-web-app-capable` meta but NOT the legacy iOS-specific
    // `apple-mobile-web-app-capable`. iOS still reads the legacy tag for
    // standalone-mode detection on older devices, so emit it explicitly.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f3f1" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1a" },
  ],
  width: "device-width",
  initialScale: 1,
  // No maximumScale — WCAG 2.1 1.4.4 requires text resize / zoom support.
  viewportFit: "cover",
};

// Inline theme detector — runs before paint to avoid FOUC.
const themeBootstrap = `(() => {
  try {
    const stored = localStorage.getItem("cp-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = stored || (prefersDark ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  } catch (_) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        {children}
        <ServiceWorkerRegister />
        <InstallPrompt />
      </body>
    </html>
  );
}
