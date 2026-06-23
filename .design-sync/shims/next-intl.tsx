// design-sync shim: next-intl -> resolves real English copy from the repo's
// en.json so previews show production strings without a runtime IntlProvider.
// Only useTranslations is used by the synced components; the rest are safety
// no-ops. Resolved via tsconfig.sync.json paths.
import * as React from "react";
import en from "@/lib/i18n/messages/en.json";

type Dict = Record<string, unknown>;

function get(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((o, k) => (o == null ? undefined : (o as Dict)[k]), obj);
}

function humanize(key: string): string {
  const last = String(key).split(".").pop() ?? "";
  return last
    .replace(/[._-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function interpolate(s: string, values?: Record<string, unknown>): string {
  if (!values) return s;
  return s.replace(/\{(\w+)[^}]*\}/g, (_, k) =>
    values[k] != null ? String(values[k]) : `{${k}}`,
  );
}

export function useTranslations(namespace?: string) {
  const ns = namespace ? get(en, namespace) : en;
  const t = (key: string, values?: Record<string, unknown>) => {
    const v = get(ns, key);
    return typeof v === "string" ? interpolate(v, values) : humanize(key);
  };
  t.rich = (key: string) => {
    const v = get(ns, key);
    return typeof v === "string" ? v : humanize(key);
  };
  t.markup = t.rich;
  t.raw = (key: string) => get(ns, key);
  t.has = (key: string) => get(ns, key) != null;
  return t;
}

export function useLocale() {
  return "en";
}
export function useFormatter() {
  return {
    number: (n: number) => String(n),
    dateTime: (d: unknown) => String(d),
    relativeTime: (d: unknown) => String(d),
    list: (items: Iterable<string>) => Array.from(items).join(", "),
  };
}
export function useMessages() {
  return en;
}
export const NextIntlClientProvider = ({ children }: { children?: React.ReactNode }) =>
  children as React.ReactElement;
