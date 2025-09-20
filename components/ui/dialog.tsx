import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 bg-black/30 backdrop-blur-sm transition-all duration-200",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center p-4",
        className
      )}
      {...props}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        {children}
      </div>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader: React.FC<React.ComponentProps<"div">> = ({ className, ...props }) => (
  <div className={cn("flex flex-col space-y-1.5 px-6 pt-6", className)} {...props} />
);

const DialogBody: React.FC<React.ComponentProps<"div">> = ({ className, ...props }) => (
  <div className={cn("px-6 py-4", className)} {...props} />
);

const DialogFooter: React.FC<React.ComponentProps<"div">> = ({ className, ...props }) => (
  <div className={cn("flex flex-col-reverse gap-2 px-6 pb-6 sm:flex-row sm:justify-end", className)} {...props} />
);

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogClose,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogBody,
  DialogFooter,
};