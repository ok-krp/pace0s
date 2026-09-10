import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[60px] w-full rounded-xl border border-[color-mix(in_oklab,var(--foreground)_10%,transparent)] bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)*0.62))] px-3 py-2 text-base text-foreground shadow-[inset_0_1px_0_0_color-mix(in_oklab,white_18%,transparent),var(--glass-elev-1)] backdrop-blur-[var(--glass-blur-thin)] backdrop-saturate-[var(--glass-saturate)] transition-[box-shadow,border-color,background-color] duration-200 placeholder:text-muted-foreground focus-visible:border-primary/35 focus-visible:bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)*0.82))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
