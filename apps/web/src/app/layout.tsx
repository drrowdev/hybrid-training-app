import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Archivo } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/shell/ServiceWorkerRegister";
import { InstallPrompt } from "@/components/shell/InstallPrompt";
import { APPLE_SPLASH_SCREENS } from "@/lib/pwa/splash-screens";
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

// Brand wordmark face (S×C). Bold only — used for the nav brand glyph.
const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  weight: "700",
  variable: "--font-brand",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://getsxc.app"),
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
    // iOS launch ("splash") screens — one per device, keyed by media query.
    // Source: scripts/generate-splash.mjs.
    other: APPLE_SPLASH_SCREENS.map((s) => ({
      rel: "apple-touch-startup-image",
      url: s.url,
      media: s.media,
    })),
  },
  openGraph: {
    type: "website",
    siteName: "SxC — Strength × Cardio",
    title: "Hybrid Training",
    description: "Train hybrid. One plan, two modalities, zero collisions.",
    url: "https://getsxc.app",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "SxC — Strength × Cardio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Hybrid Training",
    description: "Train hybrid. One plan, two modalities, zero collisions.",
    images: ["/og-image.png"],
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
    <html lang="en" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable} ${archivo.variable}`}>
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
