import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Liquid Glass buttons — thin glass material, Fresnel rim.
 * Keep press feedback visual without scaling the control, avoiding the
 * zoom-in/zoom-out effect on compact Sport session controls.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl text-sm font-medium transition-[box-shadow,background-color,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "text-primary-foreground bg-[color-mix(in_oklab,var(--primary)_88%,transparent)] backdrop-blur-[var(--glass-blur-thin)] backdrop-saturate-[var(--glass-saturate)] border border-[color-mix(in_oklab,white_28%,transparent)] shadow-[inset_0_1px_0_0_color-mix(in_oklab,white_35%,transparent),var(--glass-elev-1)] hover:bg-[color-mix(in_oklab,var(--primary)_96%,transparent)] hover:shadow-[inset_0_1px_0_0_color-mix(in_oklab,white_45%,transparent),var(--glass-elev-2)]",
        destructive:
          "text-destructive-foreground bg-[color-mix(in_oklab,var(--destructive)_86%,transparent)] backdrop-blur-[var(--glass-blur-thin)] border border-[color-mix(in_oklab,white_24%,transparent)] shadow-[inset_0_1px_0_0_color-mix(in_oklab,white_30%,transparent),var(--glass-elev-1)] hover:bg-[color-mix(in_oklab,var(--destructive)_96%,transparent)]",
        outline: "glass-thin",
        secondary: "glass-thin",
        glass: "glass-thin",
        ghost:
          "text-muted-foreground hover:text-foreground hover:bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)*0.5))] hover:backdrop-blur-[var(--glass-blur-thin)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-xl px-3 text-xs",
        lg: "h-11 rounded-2xl px-8",
        icon: "h-9 w-9 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
