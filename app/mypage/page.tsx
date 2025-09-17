"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { PortalButton } from "@/app/mypage/_components/PortalButton";
import { useRouter } from "next/navigation";

type Plan = "lite" | "business" | null;

interface SubscriptionData {
  current_plan: Plan;
  email?: string;
  product_name?: string;
  addon_unit_amount?: number;
  addon_currency?: string;
}

export default function MyPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sub, setSub] = useState<SubscriptionData | null>(null);

  const handleCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/stripe/subscription-by-email?email=${encodeURIComponent(
          email.trim()
        )}&debug=1`
      );
      if (!res.ok) throw new Error("プラン情報の取得に失敗しました");
      const data = (await res.json()) as SubscriptionData;
      setSub(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">マイページ</h1>
          <p className="text-gray-600">
            メールアドレスでご契約状況を確認します
          </p>
        </div>

        {!sub && (
          <Card className="shadow-md border-0 rounded-2xl mb-6">
            <CardHeader>
              <CardTitle className="text-xl">メールアドレスを入力</CardTitle>
              <CardDescription>
                ご契約状況に応じて画面を表示します。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCheck} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">メールアドレス</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    disabled={loading}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {error && (
                  <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                    {error}
                  </div>
                )}
                <Button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="w-full"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      確認中...
                    </>
                  ) : (
                    "契約状況を確認"
                  )}
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <a href={process.env.NEXT_PUBLIC_APP_URL || "/"}>
                    トップページに戻る
                  </a>
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {sub && (
          <ResolvedView
            email={sub.email || email}
            plan={sub.current_plan}
            productName={sub.product_name}
            addonUnitAmount={sub.addon_unit_amount}
            addonCurrency={sub.addon_currency}
            onReset={() => setSub(null)}
          />
        )}
      </div>
    </div>
  );
}

type ResolvedViewProps = {
  email: string;
  plan: Plan;
  productName?: string;
  addonUnitAmount?: number;
  addonCurrency?: string;
  onReset: () => void;
};
function ResolvedView({
  email,
  plan,
  productName,
  addonUnitAmount,
  addonCurrency,
  onReset,
}: ResolvedViewProps) {
  return (
    <Card className="shadow-md border-0 rounded-2xl">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            {false && (
            <CardTitle className="text-xl">
              {plan === null
                ? "購入情報がありません"
                : productName ||
                  (plan === "lite"
                    ? "Liteプラン契約済み"
                    : "Businessプラン契約済み")}
            </CardTitle>
            )}
            {plan !== null && (
              <div className="mt-1 flex items-center gap-2 font-semibold text-xl">
                現在の契約プラン: {productName || (plan === "lite" ? "Lite：月額基本料" : "Business：月額基本料")}
                <span className="inline-flex items-center rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-200">現在の契約</span>
              </div>
            )}
            <CardDescription>{email}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {false && plan !== null && (
              <span className="inline-flex items-center rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-200">
                現在の契約
              </span>
            )}
            <Button variant="outline" size="sm" onClick={onReset}>
              戻る
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {plan === null ? (
          <NoSubscription />
        ) : (
          <div className="space-y-12">
            <div className="space-y-4">
              <h3 className="text-xl font-semibold text-gray-900 pb-2 border-b border-gray-200">
                配信先追加
              </h3>
              {typeof addonUnitAmount !== "undefined" && (
                <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
                  追加料金 (月額) :{" "}
                  {formatCurrency(addonUnitAmount, addonCurrency)} /
                  1メールアドレス
                </div>
              )}
              <AddRecipientsSection
                email={email}
                plan={plan}
                productName={productName}
                addonUnitAmount={addonUnitAmount}
                addonCurrency={addonCurrency}
              />
            </div>

            <div className="space-y-4">
              <h3 className="text-xl font-semibold text-gray-900 pb-2 border-b border-gray-200">
                サブスクリプションの管理
              </h3>
              <PortalButton email={email} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NoSubscription() {
  return (
    <div className="space-y-4">
      <p className="text-gray-700">
        購入情報がありません。トップページからサブスクリプションを購入できます。
      </p>
      <Button asChild className="w-full">
        <a href="/">トップページへ</a>
      </Button>
    </div>
  );
}

type AddRecipientsSectionProps = {
  email: string;
  plan: Exclude<Plan, null>;
  productName?: string;
  addonUnitAmount?: number;
  addonCurrency?: string;
};
function AddRecipientsSection({
  email,
  plan,
  productName,
  addonUnitAmount,
  addonCurrency,
}: AddRecipientsSectionProps) {
  const [count, setCount] = useState<number>(1);
  const [emails, setEmails] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Adjust emails array length to count
    setEmails((prev) => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push("");
      return next;
    });
  }, [count]);

  // Switched from Payment Links to Checkout Session API to ensure quantity is honored
  // Keep a dummy value so legacy checks like `if (!stripeUrl)` skip early returns.
  const stripeUrl = "checkout-session";

  const updateEmail = (idx: number, value: string) => {
    setEmails((prev) => prev.map((v, i) => (i === idx ? value : v)));
  };

  const handleProceed = async () => {
    if (!stripeUrl) {
      setError("購入リンクが未設定です");
      return;
    }
    // Basic validation
    const trimmed = emails.map((e) => e.trim()).filter(Boolean);
    if (trimmed.length !== count) {
      setError("人数分のメールアドレスを入力してください");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // 保存してからStripeへ遷移
      const res = await fetch("/api/recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerEmail: email, plan, recipients: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "保存に失敗しました");
      }
      // Create Stripe Checkout Session on server with accurate quantity
      const checkoutRes = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, quantity: count, ownerEmail: email }),
      });
      if (!checkoutRes.ok) {
        const data = await checkoutRes.json().catch(() => null);
        throw new Error(data?.error || "Checkoutの作成に失敗しました");
      }
      const { url } = await checkoutRes.json();
      if (!url) throw new Error("Checkout URLが取得できませんでした");
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="count">追加するメールアドレス数（最大10）</Label>
        <Input
          id="count"
          type="number"
          min={1}
          max={10}
          value={count}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) {
              const clamped = Math.min(10, Math.max(1, Math.floor(n)));
              setCount(clamped);
            }
          }}
        />
      </div>

      <div className="space-y-3">
        <Label>追加するメールアドレスを入力</Label>
        {emails.map((val, i) => (
          <Input
            key={i}
            type="email"
            required
            value={val}
            onChange={(e) => updateEmail(i, e.target.value)}
            placeholder={`example${i + 1}@email.com`}
          />
        ))}
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid gap-3">
        <Button
          onClick={handleProceed}
          disabled={saving}
          variant="outline"
          className="w-full h-auto p-3 justify-center text-base font-semibold rounded-lg border-2 border-gray-300 bg-white shadow-sm hover:border-gray-400 hover:shadow-md transition"
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              保存中...
            </>
          ) : (
            "追加購入へ進む"
          )}
        </Button>
      </div>
    </div>
  );
}

function formatCurrency(amount: number, currency?: string) {
  const c = (currency || "jpy").toLowerCase();
  const zeroDecimal = new Set(["jpy", "krw"]);
  const value = zeroDecimal.has(c) ? amount : amount / 100;
  try {
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency: (currency || "JPY").toUpperCase(),
    }).format(value);
  } catch {
    return `${value} ${currency?.toUpperCase() || "JPY"}`;
  }
}
