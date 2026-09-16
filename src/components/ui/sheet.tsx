"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const AI_HISTORY_STORAGE_KEY = "pace.ai.mobile-history-open";

const Sheet = (props: React.ComponentProps<typeof SheetPrimitive.Root>) => {
  const isAiRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/ai/");
  const isControlled = props.open !== undefined;
  const [restoreOpen, setRestoreOpen] = React.useState(false);

  React.useEffect(() => {
    if (!isAiRoute || !isControlled) return;
    try {
      setRestoreOpen(window.sessionStorage.getItem(AI_HISTORY_STORAGE_KEY) === "1");
    } catch {
      setRestoreOpen(false);
    }
  }, [isAiRoute, isControlled]);

  const open = isAiRoute && isControlled && restoreOpen ? true : props.open;
  const onOpenChange = (nextOpen: boolean) => {
    if (isAiRoute && isControlled) {
      try {
        window.sessionStorage.setItem(AI_HISTORY_STORAGE_KEY, nextOpen ? "1" : "0");
      } catch {
        // Storage can be unavailable in privacy-restricted contexts.
      }
      setRestoreOpen(nextOpen);
    }
    props.onOpenChange?.(nextOpen);
  };

  return <SheetPrimitive.Root {...props} open={open} onOpenChange={onOpenChange} />;
};
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-[70] bg-slate-900/15 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  "fixed z-[80] gap-4 border border-border/45 bg-[rgb(var(--glass-tint)/var(--glass-tint-strength))] supports-[backdrop-filter]:backdrop-blur-[var(--glass-blur)] supports-[backdrop-filter]:backdrop-saturate-[var(--glass-saturate)] p-6 shadow-[var(--glass-elev-3)] transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 rounded-b-[32px] rounded-t-none data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom: "inset-x-0 bottom-0 rounded-t-[32px] rounded-b-none data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 rounded-r-[32px] rounded-l-none data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right: "inset-y-0 right-0 h-full w-3/4 rounded-l-[32px] rounded-r-none data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, ...props }, ref) => {
  const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (typeof window === "undefined" || !window.location.pathname.startsWith("/ai/")) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-sheet-close]")) {
      try { window.sessionStorage.setItem(AI_HISTORY_STORAGE_KEY, "0"); } catch { /* noop */ }
      return;
    }
    try { window.sessionStorage.setItem(AI_HISTORY_STORAGE_KEY, "1"); } catch { /* noop */ }
  };

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        className={cn(sheetVariants({ side }), className)}
        onClickCapture={handleClickCapture}
        {...props}
      >
        <SheetPrimitive.Close
          data-sheet-close
          className="absolute right-4 top-4 z-10 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Fermer</span>
        </SheetPrimitive.Close>
        {children}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn("text-lg font-semibold text-foreground", className)} {...props} />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
