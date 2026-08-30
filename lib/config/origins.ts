/**
 * Trusted hosts for Next's Server Action Origin/Host CSRF check
 * (`serverActions.allowedOrigins`, ADR-0019).
 *
 * Behind the External LB the browser Origin is the public host (e.g.
 * `switchback.com`) while the request Host may be forwarded, so the public host
 * must be explicitly trusted or every Server Action POST is rejected. Derived at
 * BUILD time from `NEXT_PUBLIC_APP_URL` plus an optional comma-separated extra
 * list (full URLs or bare hosts). Pure + dependency-free so `next.config.ts` can
 * import it without pulling in the env-validating module.
 */
export function serverActionAllowedOrigins(
  appUrl: string | undefined,
  extra: string | undefined = undefined,
): string[] {
  const hosts = new Set<string>()
  const add = (value: string): void => {
    const v = value.trim()
    if (!v) return
    try {
      hosts.add(new URL(v).host)
    } catch {
      hosts.add(v)
    }
  }
  if (appUrl) add(appUrl)
  if (extra) extra.split(',').forEach(add)
  return [...hosts]
}
