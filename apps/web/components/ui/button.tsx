import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Restyled to FANOUT_UI_GUIDELINES.md §6: cobalt primary, white secondary with a line border,
// 14px radius, Jakarta 700, 2px cobalt focus ring with 2px offset, 150ms transitions.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent font-bold tracking-[-0.01em] whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 ease-[cubic-bezier(0.2,0.8,0.2,1)] outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary-solid text-primary-solid-fg hover:bg-primary-solid-hover",
        secondary: "border-border bg-surface text-foreground hover:bg-card-raised",
        outline: "border-border bg-surface text-foreground hover:bg-card-raised",
        ghost: "text-foreground hover:bg-card-raised",
        destructive: "bg-danger text-white hover:bg-danger/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 text-[15px]",
        sm: "h-9 rounded-sm px-3 text-sm",
        xs: "h-7 rounded-sm px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        lg: "h-14 px-7 text-[17px]",
        icon: "size-11",
        "icon-xs": "size-7 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9 rounded-sm",
        "icon-lg": "size-14",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
