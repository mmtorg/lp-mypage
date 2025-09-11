"use client"

import { useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RefreshCw } from "lucide-react"

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

// エラー状態のUI
export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // エラーをログに記録
    console.error("MyPage error:", error)
  }, [error])

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="mx-auto max-w-2xl">
        {/* ページタイトル */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">マイページ</h1>
          <p className="text-gray-600">プラン管理・請求情報の確認</p>
        </div>

        {/* エラーカード */}
        <Card className="shadow-md border-0 rounded-2xl">
          <CardHeader className="pb-4 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-6 w-6 text-red-600" />
            </div>
            <CardTitle className="text-xl font-semibold text-gray-900">データの取得に失敗しました</CardTitle>
            <CardDescription className="text-gray-600">サブスクリプション情報を読み込めませんでした</CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 text-center">
            {/* エラーメッセージ */}
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
              {error.message || "予期しないエラーが発生しました"}
            </div>

            {/* 対処方法 */}
            <div className="space-y-2 text-sm text-gray-600">
              <p>以下をお試しください：</p>
              <ul className="list-disc list-inside space-y-1 text-left max-w-md mx-auto">
                <li>ページを再読み込みする</li>
                <li>サインイン状態を確認する</li>
                <li>しばらく時間をおいてから再度アクセスする</li>
                <li>問題が続く場合はサポートにお問い合わせください</li>
              </ul>
            </div>

            {/* 再試行ボタン */}
            <Button onClick={reset} className="inline-flex items-center gap-2" aria-label="ページを再読み込み">
              <RefreshCw className="h-4 w-4" />
              再試行
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
