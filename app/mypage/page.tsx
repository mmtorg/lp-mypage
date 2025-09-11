"use client"

import type React from "react"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PlanActions } from "./_components/PlanActions"
import { Notice } from "./_components/Notice"
import { Loader2 } from "lucide-react"

// サブスクリプション情報の型定義
type SubscriptionPlan = "lite" | "business" | null

interface SubscriptionData {
  current_plan: SubscriptionPlan
  email?: string
}

// メインのマイページコンポーネント
export default function MyPage() {
  const [email, setEmail] = useState("")
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // メールアドレスでプラン情報を取得する関数
  const fetchSubscriptionByEmail = async (emailAddress: string) => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/me/subscription?email=${encodeURIComponent(emailAddress)}`)

      if (!response.ok) {
        throw new Error("プラン情報の取得に失敗しました")
      }

      const data = await response.json()
      setSubscriptionData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました")
    } finally {
      setLoading(false)
    }
  }

  // フォーム送信ハンドラー
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (email.trim()) {
      fetchSubscriptionByEmail(email.trim())
    }
  }

  // プランに応じた見出しテキストを決定
  const getHeadingText = (plan: SubscriptionPlan): string => {
    switch (plan) {
      case "lite":
        return "ご契約プラン：Lite"
      case "business":
        return "ご契約プラン：Business"
      default:
        return "現在、基本プランのご契約はありません"
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="mx-auto max-w-2xl">
        {/* ページタイトル */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">マイページ</h1>
          <p className="text-gray-600">プラン管理・請求情報の確認</p>
        </div>

        {/* メールアドレス入力フォーム */}
        {!subscriptionData && (
          <Card className="shadow-md border-0 rounded-2xl mb-6">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl font-semibold text-gray-900">メールアドレスを入力してください</CardTitle>
              <CardDescription className="text-gray-600">
                ご契約時のメールアドレスを入力して、現在のプラン情報を確認できます
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">メールアドレス</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="example@email.com"
                    required
                    disabled={loading}
                    className="focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {error && <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg">{error}</div>}
                <Button type="submit" disabled={loading || !email.trim()} className="w-full">
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      確認中...
                    </>
                  ) : (
                    "プラン情報を確認"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* プラン情報表示 */}
        {subscriptionData && (
          <Card className="shadow-md border-0 rounded-2xl">
            <CardHeader className="pb-4">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-xl font-semibold text-gray-900">
                    {getHeadingText(subscriptionData.current_plan)}
                  </CardTitle>
                  <CardDescription className="text-gray-600">
                    {subscriptionData.email && `登録メール: ${subscriptionData.email}`}
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSubscriptionData(null)
                    setEmail("")
                    setError(null)
                  }}
                >
                  別のメールで確認
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* プランアクション（状態別の出し分け） */}
              <PlanActions currentPlan={subscriptionData.current_plan} />

              {/* 注意事項・説明テキスト */}
              {subscriptionData.current_plan && (
                <div className="space-y-4">
                  <Notice>
                    配信先の登録は、決済後に表示されるフォームからメールアドレスを1件ずつご登録ください。購入人数＝送信回数です。
                  </Notice>
                  <Notice>解約や請求情報の確認・変更はStripeのカスタマーポータルから行えます。</Notice>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
