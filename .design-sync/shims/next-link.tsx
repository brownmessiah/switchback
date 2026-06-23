// design-sync shim: next/link -> plain <a>. Resolved via tsconfig.sync.json.
import * as React from "react";

type AnyProps = Record<string, unknown> & {
  href?: unknown;
  children?: React.ReactNode;
};

export default function Link(props: AnyProps) {
  const {
    href,
    children,
    prefetch,
    replace,
    scroll,
    shallow,
    locale,
    passHref,
    legacyBehavior,
    ...rest
  } = props;
  const h =
    typeof href === "object" && href
      ? ((href as Record<string, string>).pathname ?? "#")
      : ((href as string) ?? "#");
  return React.createElement("a", { href: h, ...rest }, children);
}
