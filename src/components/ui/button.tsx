import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/*
 * Buttons restyled to the MSI mock-ups: 10px radius, 600 weight, 40px controls on desktop and
 * 44px+ touch targets on phones (SPEC 11). Colours come from the theme tokens only.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-control text-sm font-semibold whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 ease-out outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-primary text-white hover:bg-primary-dark",
        secondary: "border border-line-input bg-surface text-ink hover:bg-page",
        ghost: "text-ink-muted hover:bg-page hover:text-ink",
        onDark: "text-on-primary-muted hover:bg-white/10 hover:text-white",
        danger: "bg-status-overdue-strong text-white hover:bg-status-overdue-fg",
      },
      size: {
        default: "min-h-11 px-4 lg:min-h-10",
        sm: "min-h-9 px-3 text-[13px]",
        field: "min-h-[52px] px-5 text-base",
        icon: "size-11 lg:size-10",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export { Button, buttonVariants };
