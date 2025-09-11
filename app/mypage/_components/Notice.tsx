import type { ReactNode } from "react"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

interface NoticeProps {
  children: ReactNode
  variant?: "info" | "warning" | "success"
  className?: string
}

// 注意事項・説明テキスト用のコンポーネント
export function Notice({ children, variant = "info", className }: NoticeProps) {
  const variantStyles = {
    info: "bg-blue-50 border-blue-200 text-blue-800",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
    success: "bg-green-50 border-green-200 text-green-800",
  }

  const iconStyles = {
    info: "text-blue-500",
    warning: "text-amber-500",
    success: "text-green-500",
  }

  return (
    <div
      className={cn("rounded-xl border p-4 text-sm leading-relaxed", variantStyles[variant], className)}
      role="note"
      aria-label="重要な情報"
    >
      <div className="flex gap-3">
        <Info className={cn("h-5 w-5 flex-shrink-0 mt-0.5", iconStyles[variant])} aria-hidden="true" />
        <div className="flex-1">{children}</div>
      </div>
    </div>
  )
}
