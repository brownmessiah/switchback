// design-sync shim: @/lib/i18n/provider. LanguageSelector reads useIntl() for
// the current locale + switchLocale(); previews have no IntlProvider context,
// so this returns inert English state. IntlProvider passes children through.
import * as React from "react";

export function useIntl() {
  return { locale: "en" as const, switchLocale: (_loc: string) => {} };
}

export function IntlProvider({ children }: { children?: React.ReactNode }) {
  return children as React.ReactElement;
}
