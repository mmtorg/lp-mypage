# サブスクリプション管理システム（マイページ）

Next.js 14 App Router + Tailwind CSS + Supabase Auth + Stripe統合による日本語対応のサブスクリプション管理画面です。

## 機能概要

- **プラン状態別UI**: 未契約/Lite/Businessの3状態に応じた画面出し分け
- **Stripe Payment Links**: 新規申込み・アドオン購入への遷移
- **Stripe Billing Portal**: 解約・請求情報管理への遷移
- **アクセシビリティ対応**: キーボード操作・ARIA属性・フォーカス管理
- **レスポンシブデザイン**: モバイルファースト設計

## ファイル構成

\`\`\`
app/mypage/
├── page.tsx                    # メインページ（サーバーコンポーネント）
├── loading.tsx                 # ローディング状態
├── error.tsx                   # エラー状態
└── _components/
    ├── PlanActions.tsx         # プラン状態別アクションボタン
    ├── PortalButton.tsx        # Stripeポータル遷移ボタン
    └── Notice.tsx              # 注意事項表示コンポーネント

app/api/
├── me/subscription/route.ts    # サブスクリプション情報取得API
└── stripe/
    ├── portal/route.ts         # Stripeポータル作成API
    └── webhook/route.ts        # Stripe Webhook受信エンドポイント

lib/
├── types.ts                    # 型定義
└── constants.ts                # 定数・テキスト定義
\`\`\`

## 環境変数設定
\`\`\`

## 実装のポイント

### 1. プラン状態の出し分け
`PlanActions.tsx` でプラン状態（null/lite/business）に応じて適切なボタンを表示

### 2. Stripe統合
- **Payment Links**: 新規申込み・アドオン購入は外部リンクで遷移
- **Billing Portal**: サーバーサイドでセッション作成後にリダイレクト

### 3. アクセシビリティ
- キーボードナビゲーション対応
- 適切なARIA属性の設定
- フォーカス可視化
- スクリーンリーダー対応

### 4. エラーハンドリング
- ネットワークエラー・APIエラーの適切な処理
- ユーザーフレンドリーなエラーメッセージ
- 再試行機能

## 今後の実装予定

1. **Supabase Auth統合**: 実際のユーザー認証との連携
2. **Stripe Webhook**: サブスクリプション状態の自動同期
3. **データベース設計**: ユーザー・サブスクリプション情報の永続化
4. **テスト**: ユニットテスト・E2Eテストの追加

## 開発・デバッグ

## Stripe Webhook設定

- エンドポイント: `/api/stripe/webhook`
- イベント: `checkout.session.completed`, `customer.subscription.*`
- Vercel ダッシュボードで Webhook を Stripe 連携に追加してください。

## Supabase スキーマ

- SQLは `supabase/schema.sql` に配置しています。必要に応じてコピーして適用してください。
