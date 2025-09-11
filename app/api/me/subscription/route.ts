import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const email = searchParams.get("email")

    if (!email) {
      return NextResponse.json({ error: "メールアドレスが必要です" }, { status: 400 })
    }

    // TODO: 実際の実装では以下を行う
    // 1. メールアドレスでユーザーを検索
    // 2. ユーザーのサブスクリプション情報をデータベースから取得
    // 3. Stripeのサブスクリプション状態と同期

    // 現在はモックデータを返す（デモ用）
    // メールアドレスに応じて異なるプランを返すシミュレーション
    const mockPlans = ["lite", "business", null] as const
    let mockPlan: (typeof mockPlans)[number]

    // メールアドレスのハッシュ値でプランを決定（デモ用）
    const emailHash = email.split("").reduce((a, b) => {
      a = (a << 5) - a + b.charCodeAt(0)
      return a & a
    }, 0)

    const planIndex = Math.abs(emailHash) % mockPlans.length
    mockPlan = mockPlans[planIndex]

    return NextResponse.json({
      current_plan: mockPlan,
      email: email,
    })
  } catch (error) {
    console.error("Subscription API error:", error)
    return NextResponse.json({ error: "サブスクリプション情報の取得に失敗しました" }, { status: 500 })
  }
}
