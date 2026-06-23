// design-sync shim: next/image -> plain <img>. Resolved via tsconfig.sync.json
// paths so the esbuild bundle never pulls the Next runtime into a preview.
import * as React from "react";

type AnyProps = Record<string, unknown> & {
  src?: unknown;
  alt?: string;
  width?: number | string;
  height?: number | string;
  fill?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

export default function Image(props: AnyProps) {
  const {
    src,
    alt = "",
    width,
    height,
    fill,
    className,
    style,
    // strip Next-only props so they don't land on the <img>
    priority,
    quality,
    sizes,
    loader,
    placeholder,
    blurDataURL,
    unoptimized,
    loading,
    fetchPriority,
    overrideSrc,
    ...rest
  } = props;
  const resolved =
    typeof src === "object" && src
      ? ((src as Record<string, string>).src ??
        (src as Record<string, string>).default ??
        "")
      : (src as string);
  const fillStyle: React.CSSProperties = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }
    : {};
  return React.createElement("img", {
    src: resolved,
    alt,
    width: fill ? undefined : (width as number | string | undefined),
    height: fill ? undefined : (height as number | string | undefined),
    className,
    style: { ...fillStyle, ...style },
    ...rest,
  });
}
