import type { Metadata } from "next";
import { DM_Sans, Noto_Sans_Devanagari } from "next/font/google";
import { getLocale, getMessages } from "next-intl/server";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { IntlProvider } from "@/lib/i18n/provider";

import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
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
  title: "Outvers — adventure activities in India",
  description:
    "Book rafting, paragliding, scuba, trekking and more across India. Vendor-verified Experiences with transparent refund policy.",
};

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
    isHindi ? notoDevanagari.variable : "",
    "h-full antialiased",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <html lang={locale} className={fontClasses} data-locale={locale}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <IntlProvider locale={locale} messages={messages as Record<string, unknown>}>
          <SiteHeader />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </IntlProvider>
      </body>
    </html>
  );
}
