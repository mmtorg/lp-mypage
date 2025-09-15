import React from "react"

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline"
  size?: "default" | "sm" | "lg"
  asChild?: boolean
  children: React.ReactNode
}

export function SimpleButton({
  className = "",
  variant = "default",
  size = "default",
  asChild = false,
  children,
  ...props
}: ButtonProps) {
  const baseClasses =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50"

  const variantClasses = {
    default: "bg-[#0b6465] text-white hover:bg-[#0b6465]/90",
    outline: "border-2 border-[#0b6465] text-[#0b6465] bg-transparent hover:bg-[#0b6465] hover:text-white",
  }

  const sizeClasses = {
    default: "h-9 px-4 py-2",
    sm: "h-8 px-3 py-1",
    lg: "h-10 px-6 py-2 text-lg",
  }

  const classes = `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, {
      className: classes,
      ...props,
    })
  }

  return (
    <button className={classes} {...props}>
      {children}
    </button>
  )
}
