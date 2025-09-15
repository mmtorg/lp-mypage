import type React from "react"

interface BadgeProps {
  className?: string
  children: React.ReactNode
}

export function SimpleBadge({ className = "", children }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}
