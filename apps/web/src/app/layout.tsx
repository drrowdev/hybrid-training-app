import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono, Archivo, Oswald, Saira_Stencil_One } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/shell/ServiceWorkerRegister";
import { SplashScreenController } from "@/components/shell/SplashScreenController";
import { APPLE_SPLASH_SCREENS } from "@/lib/pwa/splash-screens";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

// Mono face — JetBrains Mono app-wide (matches the program wizard's mono
// labels) for every --cp-font-mono kicker, stat label and code-ish numeral.
const jetbrainsMono = JetBrains_Mono({
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

// Display face — Oswald condensed, used uppercase for page/section headings
// (the wizard's signature). Exposed app-wide as --cp-font-display.
const oswald = Oswald({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
});

// Stencil face — Saira Stencil One, for big "instrument-panel" numerals and
// program glyphs. Exposed app-wide as --cp-font-stencil.
const sairaStencil = Saira_Stencil_One({
  subsets: ["latin"],
  display: "swap",
  weight: "400",
  variable: "--font-stencil",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://getsxc.app"),
  title: "S×C",
  description: "Train hybrid. One plan, two modalities, zero collisions.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "S×C",
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
    siteName: "S×C",
    title: "S×C",
    description: "Train hybrid. One plan, two modalities, zero collisions.",
    url: "https://getsxc.app",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "S×C",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "S×C",
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
    { media: "(prefers-color-scheme: light)", color: "#0f1310" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1310" },
  ],
  width: "device-width",
  initialScale: 1,
  // No maximumScale — WCAG 2.1 1.4.4 requires text resize / zoom support.
  viewportFit: "cover",
};

// Dark-only sage theme — always render dark regardless of OS/stored pref.
const themeBootstrap = `(() => {
  try {
    document.documentElement.setAttribute("data-theme", "dark");
  } catch (_) {}
})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} ${jetbrainsMono.variable} ${archivo.variable} ${oswald.variable} ${sairaStencil.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        {children}
        <SplashScreenController />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
