"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ExternalLink, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

// Stripeポータルボタンコンポーネント
export function PortalButton() {
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  // Stripeポータルへの遷移処理
  const handlePortalRedirect = async () => {
    // 多重クリック防止
    if (isLoading) return

    setIsLoading(true)

    try {
      // Stripe Billing Portal URLを取得するAPIを呼び出し
      const response = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // 必要に応じてユーザー情報やreturn_urlを送信
        body: JSON.stringify({
          return_url: window.location.href, // 現在のページに戻る
        }),
      })

      if (!response.ok) {
        throw new Error("ポータルURLの取得に失敗しました")
      }

      const data = await response.json()

      if (!data.url) {
        throw new Error("無効なポータルURLです")
      }

      // Stripe Billing Portalへリダイレクト
      window.location.assign(data.url)
    } catch (error) {
      console.error("Portal redirect error:", error)

      // エラートーストを表示
      toast({
        title: "エラーが発生しました",
        description:
          error instanceof Error
            ? error.message
            : "ポータルへの遷移に失敗しました。しばらく時間をおいて再度お試しください。",
        variant: "destructive",
      })

      setIsLoading(false)
    }
  }

  return (
    <Button
      onClick={handlePortalRedirect}
      disabled={isLoading}
      variant="outline"
      size="lg"
      className="w-full justify-start h-auto p-4 hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 bg-transparent"
      aria-label="Stripeポータルで解約・請求情報を確認"
    >
      <div className="flex items-center justify-between w-full">
        <div className="text-left">
          <div className="font-semibold text-gray-900">解約・請求情報の確認（Stripeポータル）</div>
          <div className="text-sm text-gray-600 mt-1">
            {isLoading ? "ポータルを準備中..." : "サブスクリプションの管理ができます"}
          </div>
        </div>

        {/* ローディング状態のアイコン */}
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
        ) : (
          <ExternalLink className="h-5 w-5 text-gray-500" />
        )}
      </div>
    </Button>
  )
}
