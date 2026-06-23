// design-sync shim: next/navigation hooks -> inert stubs so client components
// that read the App Router render statically in a preview. Resolved via
// tsconfig.sync.json paths.
const noop = () => {};

export function useRouter() {
  return {
    push: noop,
    replace: noop,
    back: noop,
    forward: noop,
    refresh: noop,
    prefetch: noop,
  };
}
export function usePathname() {
  return "/";
}
export function useSearchParams() {
  return new URLSearchParams();
}
export function useParams() {
  return {} as Record<string, string>;
}
export function useSelectedLayoutSegment() {
  return null;
}
export function useSelectedLayoutSegments() {
  return [] as string[];
}
export function redirect() {}
export function permanentRedirect() {}
export function notFound() {}
