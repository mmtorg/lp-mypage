import type React from "react"

interface CardProps {
  className?: string
  children: React.ReactNode
}

interface CardHeaderProps {
  className?: string
  children: React.ReactNode
}

interface CardContentProps {
  className?: string
  children: React.ReactNode
}

interface CardTitleProps {
  className?: string
  children: React.ReactNode
}

interface CardDescriptionProps {
  className?: string
  children: React.ReactNode
}

export function SimpleCard({ className = "", children }: CardProps) {
  return <div className={`bg-white rounded-lg shadow-lg ${className}`}>{children}</div>
}

export function SimpleCardHeader({ className = "", children }: CardHeaderProps) {
  return <div className={`p-6 ${className}`}>{children}</div>
}

export function SimpleCardContent({ className = "", children }: CardContentProps) {
  return <div className={`p-6 pt-0 ${className}`}>{children}</div>
}

export function SimpleCardTitle({ className = "", children }: CardTitleProps) {
  return <h3 className={`text-2xl font-semibold leading-none tracking-tight ${className}`}>{children}</h3>
}

export function SimpleCardDescription({ className = "", children }: CardDescriptionProps) {
  return <p className={`text-sm text-gray-600 ${className}`}>{children}</p>
}
