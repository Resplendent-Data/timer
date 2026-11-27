import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent px-4 py-2 text-sm font-semibold transition-all duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45 active:scale-[0.985]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_6px_20px_-6px_rgba(157,116,255,0.6)] hover:brightness-110",
        destructive:
          "bg-destructive text-white shadow-[0_6px_20px_-6px_rgba(244,93,122,0.55)] hover:brightness-110 focus-visible:ring-destructive/35",
        outline:
          "border-white/10 bg-white/[0.03] text-foreground hover:bg-white/[0.07] hover:border-white/15",
        secondary:
          "bg-secondary text-secondary-foreground border-white/[0.06] hover:bg-secondary/80",
        ghost:
          "border-transparent text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
        link: "border-transparent px-0 text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-10",
        sm: "h-8 px-3 text-xs rounded-lg",
        lg: "h-12 px-6 text-sm",
        icon: "size-9 p-0",
        "icon-sm": "size-7 p-0 rounded-lg",
        "icon-lg": "size-11 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
