// アプリケーション全体で使用する定数

// プラン表示名のマッピング
export const PLAN_DISPLAY_NAMES = {
  lite: "Lite",
  business: "Business",
  null: "未契約",
} as const

// プラン説明文
export const PLAN_DESCRIPTIONS = {
  lite: "基本機能をお手軽にご利用いただけるプランです",
  business: "高度な機能で業務効率化を実現するプランです",
} as const

// UI表示用のテキスト定数
export const UI_TEXTS = {
  // ページタイトル
  PAGE_TITLE: "マイページ",
  PAGE_SUBTITLE: "プラン管理・請求情報の確認",

  // プラン状態別の見出し
  NO_PLAN_HEADING: "現在、基本プランのご契約はありません",
  LITE_PLAN_HEADING: "ご契約プラン：Lite",
  BUSINESS_PLAN_HEADING: "ご契約プラン：Business",

  // ボタンテキスト
  LITE_MONTHLY_BUTTON: "Lite（月額）に申し込む",
  LITE_YEARLY_BUTTON: "Lite（年額）に申し込む",
  BUSINESS_MONTHLY_BUTTON: "Business（月額）に申し込む",
  BUSINESS_YEARLY_BUTTON: "Business（年額）に申し込む",
  ADD_SEATS_BUTTON: "配信先を追加（人数を指定）",
  PORTAL_BUTTON: "解約・請求情報の確認（Stripeポータル）",

  // 注意事項
  SEATS_NOTICE:
    "配信先の登録は、決済後に表示されるフォームからメールアドレスを1件ずつご登録ください。購入人数＝送信回数です。",
  PORTAL_NOTICE: "解約や請求情報の確認・変更はStripeのカスタマーポータルから行えます。",

  // エラーメッセージ
  SUBSCRIPTION_FETCH_ERROR: "サブスクリプション情報の取得に失敗しました",
  PORTAL_REDIRECT_ERROR: "ポータルへの遷移に失敗しました",
  GENERAL_ERROR: "予期しないエラーが発生しました",

  // ローディングメッセージ
  LOADING_SUBSCRIPTION: "プラン情報を読み込み中...",
  LOADING_PORTAL: "ポータルを準備中...",
} as const

// APIエンドポイント
export const API_ENDPOINTS = {
  SUBSCRIPTION: "/api/me/subscription",
  STRIPE_PORTAL: "/api/stripe/portal",
} as const
