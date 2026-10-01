import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { siteOrigin } from "@/lib/site-url";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  weight: "700",
  subsets: ["latin"],
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
});

const title = "Fanout · Pay everyone, all at once";
const description =
  "Fanout turns one deposit into many payouts that land in seconds, in dollars. Built at Monad Metropolis 2026.";

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title,
  description,
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Fanout" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/og-image.png"] },
};

// Browser chrome colour for the default (light) theme; mirrors --bg in tokens.css.
// ThemeColorSync switches it when the user picks Dark or System.
export const viewport: Viewport = {
  themeColor: "#FFF6EA",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: next-themes sets data-theme on <html> before React hydrates.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${bricolage.variable} ${jakarta.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla) add attributes to <body> before React loads. */}
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
