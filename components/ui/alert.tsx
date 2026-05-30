import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Alert / Banner — net-new primitive (DESIGN.md §3).
 *
 * The as-is system had no alert surface. This composes the same conventions as
 * the other primitives (cn() + CVA + data-slot, lucide icon slot) and draws its
 * status variants from the new semantic-status token family (DESIGN.md §2.1):
 * each variant uses the role's `-subtle` tint as the fill and the role ink as
 * text. Status is never color-alone — call sites pass a leading lucide icon
 * (check / clock / info / alert), per DESIGN.md §1.3 + WCAG 1.4.1.
 *
 * Used for: form-error summary, ranking-disclosure ("How we rank", info),
 * money-path errors, and honest-constraint notices (DESIGN.md §3, §4 A2/A6/B1).
 */
const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-[var(--radius-card)] border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground border-border",
        destructive:
          "bg-destructive-subtle text-destructive border-destructive/20 [&>svg]:text-destructive",
        success:
          "bg-success-subtle text-success border-success/20 [&>svg]:text-success",
        warning:
          "bg-warning-subtle text-warning border-warning/20 [&>svg]:text-warning",
        info: "bg-info-subtle text-info border-info/20 [&>svg]:text-info",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant = "default",
  role = "alert",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={role}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 line-clamp-1 min-h-4 font-heading font-medium tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 grid justify-items-start gap-1 text-sm text-current/80 [&_p]:leading-relaxed",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, alertVariants }
