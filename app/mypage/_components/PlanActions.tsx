import { Button } from "@/components/ui/button"
import { PortalButton } from "./PortalButton"

// プランの型定義
type SubscriptionPlan = "lite" | "business" | null

interface PlanActionsProps {
  currentPlan: SubscriptionPlan
}

// プラン状態に応じてアクションボタンを出し分けるコンポーネント
export function PlanActions({ currentPlan }: PlanActionsProps) {
  // 未契約の場合：新規申込みボタンを表示
  if (currentPlan === null) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 mb-4">プランを選択してください</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Lite プラン */}
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-auto p-4 text-left flex-col items-start hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 bg-transparent"
          >
            <a
              href={process.env.NEXT_PUBLIC_PL_NEW_LITE_MONTHLY}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Lite月額プランに申し込む"
            >
              <div className="font-semibold text-gray-900">Lite（月額）に申し込む</div>
              <div className="text-sm text-gray-600 mt-1">基本機能をお手軽に</div>
            </a>
          </Button>

          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-auto p-4 text-left flex-col items-start hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 bg-transparent"
          >
            <a
              href={process.env.NEXT_PUBLIC_PL_NEW_LITE_YEARLY}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Lite年額プランに申し込む"
            >
              <div className="font-semibold text-gray-900">Lite（年額）に申し込む</div>
              <div className="text-sm text-gray-600 mt-1">年額でお得に利用</div>
            </a>
          </Button>

          {/* Business プラン */}
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-auto p-4 text-left flex-col items-start hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 bg-transparent"
          >
            <a
              href={process.env.NEXT_PUBLIC_PL_NEW_BUS_MONTHLY}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Business月額プランに申し込む"
            >
              <div className="font-semibold text-gray-900">Business（月額）に申し込む</div>
              <div className="text-sm text-gray-600 mt-1">高度な機能で業務効率化</div>
            </a>
          </Button>

          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-auto p-4 text-left flex-col items-start hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 bg-transparent"
          >
            <a
              href={process.env.NEXT_PUBLIC_PL_NEW_BUS_YEARLY}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Business年額プランに申し込む"
            >
              <div className="font-semibold text-gray-900">Business（年額）に申し込む</div>
              <div className="text-sm text-gray-600 mt-1">年額でさらにお得</div>
            </a>
          </Button>
        </div>
      </div>
    )
  }

  // Lite契約の場合：配信先追加とポータルボタンを表示
  if (currentPlan === "lite") {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 mb-4">プラン管理</h3>
        <div className="space-y-3">
          {/* 配信先追加ボタン（Lite用） */}
          <Button
            asChild
            variant="outline"
            size="lg"
            className="w-full justify-start h-auto p-4 hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 bg-transparent"
          >
            <a
              href={process.env.NEXT_PUBLIC_PL_ADDON_LITE_SEAT}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="配信先を追加する"
            >
              <div className="text-left">
                <div className="font-semibold text-gray-900">配信先を追加（人数を指定）</div>
                <div className="text-sm text-gray-600 mt-1">追加の配信先を購入できます</div>
              </div>
            </a>
          </Button>

          {/* Stripeポータルボタン */}
          <PortalButton />
        </div>
      </div>
    )
  }

  // Business契約の場合：配信先追加とポータルボタンを表示（Business用アドオン）
  if (currentPlan === "business") {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-900 mb-4">プラン管理</h3>
        <div className="space-y-3">
          {/* 配信先追加ボタン（Business用） */}
          <Button
            asChild
            variant="outline"
            size="lg"
            className="w-full justify-start h-auto p-4 hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 bg-transparent"
          >
            <a
              href={process.env.NEXT_PUBLIC_PL_ADDON_BUS_SEAT}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="配信先を追加する"
            >
              <div className="text-left">
                <div className="font-semibold text-gray-900">配信先を追加（人数を指定）</div>
                <div className="text-sm text-gray-600 mt-1">追加の配信先を購入できます</div>
              </div>
            </a>
          </Button>

          {/* Stripeポータルボタン */}
          <PortalButton />
        </div>
      </div>
    )
  }

  // フォールバック（通常は到達しない）
  return null
}
