import * as React from "react";

import { cn } from "@/lib/utils";

const MIN_MESSAGE_HEIGHT = 44;
const MAX_MESSAGE_LINES = 8;

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, onInput, rows, value, defaultValue, ...props }, forwardedRef) => {
    const internalRef = React.useRef<HTMLTextAreaElement | null>(null);
    const autoGrow = rows === 1;

    const setRef = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        internalRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    const resize = React.useCallback(() => {
      const textarea = internalRef.current;
      if (!textarea || !autoGrow) return;

      textarea.style.height = "auto";
      const styles = window.getComputedStyle(textarea);
      const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
      const padding = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0);
      const maxHeight = Math.max(MIN_MESSAGE_HEIGHT, lineHeight * MAX_MESSAGE_LINES + padding);
      const nextHeight = Math.min(Math.max(textarea.scrollHeight, MIN_MESSAGE_HEIGHT), maxHeight);

      textarea.style.height = `${nextHeight}px`;
      textarea.style.maxHeight = `${maxHeight}px`;
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    }, [autoGrow]);

    React.useLayoutEffect(() => {
      resize();
    }, [resize, value, defaultValue]);

    const handleInput = (event: React.InputEvent<HTMLTextAreaElement>) => {
      resize();
      onInput?.(event);
    };

    return (
      <textarea
        className={cn(
          "flex min-h-[60px] w-full rounded-xl border border-[color-mix(in_oklab,var(--foreground)_10%,transparent)] bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)*0.62))] px-3 py-2 text-base text-foreground shadow-[inset_0_1px_0_0_color-mix(in_oklab,white_18%,transparent),var(--glass-elev-1)] backdrop-blur-[var(--glass-blur-thin)] backdrop-saturate-[var(--glass-saturate)] transition-[box-shadow,border-color,background-color] duration-200 placeholder:text-muted-foreground focus-visible:border-primary/35 focus-visible:bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)*0.82))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={setRef}
        rows={rows}
        value={value}
        defaultValue={defaultValue}
        onInput={handleInput}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
