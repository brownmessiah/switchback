import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  DM_Sans,
  Noto_Sans_Devanagari,
} from "next/font/google";
import { getLocale, getMessages } from "next-intl/server";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Toaster } from "@/components/ui/toaster";
import { IntlProvider } from "@/lib/i18n/provider";

import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

/**
 * Bricolage Grotesque — the display heading face (DESIGN.md §2.2). Bound to
 * --font-heading, it gives long PDPs and policy pages a distinct heading tier
 * the as-is `--font-heading = --font-sans` aliasing lacked. It is a Latin-only
 * enhancement: for Indic locales (hi, and future ta/mr/bn) globals.css
 * re-resolves --font-heading to the Devanagari → DM Sans stack (ADR-0012).
 */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-heading",
  weight: ["600", "700"],
});

/**
 * Noto Sans Devanagari — loaded as a supplementary font for Hindi (hi) locale.
 * The font file is always available (module-level instantiation required by
 * next/font), but the CSS variable is only applied to the <html> element when
 * the resolved locale is "hi". This prevents unnecessary font downloads for
 * English-only sessions.
 */
const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  variable: "--font-devanagari",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Switchback — book verified adventure experiences across India",
  description:
    "Book rafting, paragliding, scuba, trekking and more across India. Vendor-verified Experiences with transparent refund policy.",
};

/**
 * No-flash theme bootstrap. Runs before first paint to set the `.dark` class on
 * <html> from the saved preference (localStorage `switchback-theme`) or the OS
 * setting, so the dark palette (globals.css `.dark`) applies without a
 * light→dark flash. The ThemeToggle in the header flips + persists it.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('switchback-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const isHindi = locale === "hi";

  const fontClasses = [
    dmSans.variable,
    bricolage.variable,
    isHindi ? notoDevanagari.variable : "",
    "h-full antialiased",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <html lang={locale} className={fontClasses} data-locale={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <IntlProvider locale={locale} messages={messages as Record<string, unknown>}>
          <SiteHeader />
          <div className="flex-1">{children}</div>
          <SiteFooter />
          {/* Global toaster (issue 24, D11) — mounted ONCE at the true root so
              action toasts surface on every surface (marketing + app + vendor +
              admin). Coexists with the locale-layout compare tray + rails. */}
          <Toaster />
        </IntlProvider>
      </body>
    </html>
  );
}
