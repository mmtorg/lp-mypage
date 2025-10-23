// サブスクリプション関連の型定義

// プランの種類
export type SubscriptionPlan = "lite" | "business" | "trial" | null

// サブスクリプション情報のレスポンス型
export interface SubscriptionResponse {
  current_plan: SubscriptionPlan
  customer_id?: string
  subscription_id?: string
  status?: "active" | "canceled" | "past_due" | "unpaid" | "trialing"
  current_period_end?: string;
}

// Stripe Portal APIのレスポンス型
export interface PortalResponse {
  url: string
}

// エラーレスポンス型
export interface ErrorResponse {
  error: string
  message?: string
}

// 環境変数の型定義（型安全性のため）
export interface PaymentLinks {
  NEXT_PUBLIC_PL_NEW_LITE_MONTHLY: string
  NEXT_PUBLIC_PL_NEW_LITE_YEARLY: string
  NEXT_PUBLIC_PL_NEW_BUS_MONTHLY: string
  NEXT_PUBLIC_PL_NEW_BUS_YEARLY: string
  NEXT_PUBLIC_PL_ADDON_LITE_SEAT_MONTHLY: string
  NEXT_PUBLIC_PL_ADDON_BUS_SEAT_MONTHLY: string
}
