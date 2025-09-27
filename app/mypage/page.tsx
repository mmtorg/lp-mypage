"use client";

import { useEffect, useMemo, useState } from "react";
import Script from "next/script";
import Link from "next/link";
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
import { Loader2, Eye, EyeOff } from "lucide-react";
import { PortalButton } from "@/app/mypage/_components/PortalButton";
import { useToast } from "@/hooks/use-toast";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogBody,
} from "@/components/ui/dialog";

const MAX_ADDITIONAL_RECIPIENTS = 10;
const SESSION_EMAIL_KEY = "mypage:lastEmail:session";

type Plan = "lite" | "business" | null;

type RecipientInfo = {
  email: string;
  created_via: "initial" | "addon" | null;
  is_owner: boolean;
  pending_removal?: boolean;
};

type PurchasedItem = {
  name: string;
  quantity: number;
  type: "base" | "addon";
  price_id?: string;
  product_id?: string;
};

interface SubscriptionData {
  current_plan: Plan;
  email?: string;
  product_name?: string;
  unit_amount?: number;
  currency?: string;
  billing_interval?: "month" | "year" | null;
  recipients?: RecipientInfo[];
  purchased_items?: PurchasedItem[];
  is_trialing?: boolean;
}

export default function MyPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sub, setSub] = useState<SubscriptionData | null>(null);
  const [booting, setBooting] = useState(false); // セッション復元中の表示制御
  const [hydrated, setHydrated] = useState(false); // SSRと一致させるためのハイドレーション完了フラグ
  const [authStage, setAuthStage] = useState<
    null | "login" | "register" | "emailSent"
  >(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);

  const refreshByEmail = async (targetEmail?: string) => {
    const e = (targetEmail ?? email).trim();
    if (!e) return;
    try {
      setLoading(true);
      const res = await fetch(
        `/api/stripe/subscription-by-email?email=${encodeURIComponent(
          e
        )}&force=1&_=${Date.now()}`
      );
      if (!res.ok) throw new Error("契約情報の取得に失敗しました");
      const data = (await res.json()) as SubscriptionData;
      setSub(data);
      setError(null);
      // If user has an active/trialing plan, decide auth stage
      try {
        if (data.current_plan || data.is_trialing) {
          const supabase = getSupabaseBrowser();
          const { data: sessionRes } = await supabase.auth.getUser();
          const authedEmail = sessionRes.user?.email?.toLowerCase();
          if (authedEmail && authedEmail === e.toLowerCase()) {
            setIsAuthed(true);
            setAuthStage(null);
          } else {
            setIsAuthed(false);
            // ask server if a user exists for this email
            const chk = await fetch(
              `/api/auth/check-user?email=${encodeURIComponent(e)}`
            );
            const json = await chk.json();
            if (chk.ok && json && typeof json.exists === "boolean") {
              setAuthStage(json.exists ? "login" : "register");
            } else {
              setAuthStage("login");
            }
          }
        } else {
          setIsAuthed(false);
          setAuthStage(null);
        }
      } catch {}
      try {
        sessionStorage.setItem(SESSION_EMAIL_KEY, e);
      } catch {}
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setHydrated(true);
    try {
      const last = sessionStorage.getItem(SESSION_EMAIL_KEY);
      if (last && !sub) {
        setEmail(last);
        setBooting(true);
        refreshByEmail(last);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 初回ブート中はフェッチ完了までフォームを隠す
  useEffect(() => {
    if (booting && !loading) {
      setBooting(false);
    }
  }, [booting, loading]);

  const handleCheck = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/stripe/subscription-by-email?email=${encodeURIComponent(
          email.trim()
        )}`
      );
      if (!res.ok) {
        throw new Error("契約情報の取得に失敗しました");
      }
      const data = (await res.json()) as SubscriptionData;
      setSub(data);
      // decide auth stage similar to refreshByEmail
      try {
        if (data.current_plan || data.is_trialing) {
          const supabase = getSupabaseBrowser();
          const { data: sessionRes } = await supabase.auth.getUser();
          const authedEmail = sessionRes.user?.email?.toLowerCase();
          if (authedEmail && authedEmail === email.trim().toLowerCase()) {
            setIsAuthed(true);
            setAuthStage(null);
          } else {
            setIsAuthed(false);
            const chk = await fetch(
              `/api/auth/check-user?email=${encodeURIComponent(email.trim())}`
            );
            const json = await chk.json();
            if (chk.ok && json && typeof json.exists === "boolean") {
              setAuthStage(json.exists ? "login" : "register");
            } else {
              setAuthStage("login");
            }
          }
        } else {
          setIsAuthed(false);
          setAuthStage(null);
        }
      } catch {}
      try {
        sessionStorage.setItem(SESSION_EMAIL_KEY, email.trim());
      } catch {}
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div
        className={`mx-auto ${sub?.is_trialing ? "max-w-5xl" : "max-w-2xl"}`}
      >
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-3xl font-bold text-gray-900">マイページ</h1>
          <p className="text-gray-600">
            メールアドレスでご契約状況を確認できます
          </p>
        </div>

        {!sub &&
          (!hydrated ? (
            <div />
          ) : booting ? (
            <Card className="mb-6 rounded-2xl border-0 shadow-md">
              <CardHeader>
                <CardTitle className="text-xl">読み込み中...</CardTitle>
                <CardDescription>ご契約情報を取得しています</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center py-6 text-gray-600">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  最新の状態を読み込んでいます
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="mb-6 rounded-2xl border-0 shadow-md">
              <CardHeader>
                <CardTitle className="text-xl">メールアドレスを入力</CardTitle>
                <CardDescription>
                  ご契約状況に応じて画面を表示します
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
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      placeholder="you@example.com"
                      className="focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  {error && (
                    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
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
                  <Button asChild variant="outline" className="w-full mt-2">
                    <a href={process.env.NEXT_PUBLIC_APP_URL || "/"}>
                      トップページに戻る
                    </a>
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}

        {sub && isAuthed && (sub.current_plan || sub.is_trialing) && (
          <ResolvedView
            email={sub.email || email}
            plan={sub.current_plan}
            productName={sub.product_name}
            unitAmount={sub.unit_amount}
            currency={sub.currency}
            billingInterval={sub.billing_interval ?? undefined}
            recipients={sub.recipients}
            purchasedItems={sub.purchased_items}
            isTrialing={sub.is_trialing}
            onRefetch={refreshByEmail}
            onLogout={async () => {
              const supabase = getSupabaseBrowser();
              await supabase.auth.signOut();
              try {
                sessionStorage.removeItem(SESSION_EMAIL_KEY);
              } catch {}
              setIsAuthed(false);
              setAuthStage(null);
              setSub(null);
              setPassword("");
            }}
          />
        )}

        {sub && !isAuthed && (sub.current_plan || sub.is_trialing) && (
          <div className="mx-auto max-w-2xl">
            <AuthGate
              stage={authStage}
              busy={authBusy}
              error={authError}
              email={sub.email || email}
              password={password}
              password2={password2}
              onChangePassword={setPassword}
              onChangePassword2={setPassword2}
              onReset={() => {
                setSub(null);
                setAuthStage(null);
                setPassword("");
                setPassword2("");
                setAuthError(null);
              }}
              onLogin={async () => {
                setAuthError(null);
                setAuthBusy(true);
                try {
                  const supabase = getSupabaseBrowser();
                  const { error } = await supabase.auth.signInWithPassword({
                    email: (sub.email || email).trim(),
                    password,
                  });
                  if (error) throw error;
                  // Verify email match and refresh
                  const { data: me } = await supabase.auth.getUser();
                  const authedEmail = me.user?.email?.toLowerCase();
                  if (
                    authedEmail &&
                    authedEmail === (sub.email || email).trim().toLowerCase()
                  ) {
                    setIsAuthed(true);
                    setAuthStage(null);
                    await refreshByEmail(sub.email || email);
                  } else {
                    setAuthError("メールアドレスが一致しませんでした");
                  }
                } catch (err) {
                  setAuthError(
                    err instanceof Error
                      ? err.message
                      : "ログインに失敗しました"
                  );
                } finally {
                  setAuthBusy(false);
                }
              }}
              onRegister={async () => {
                const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
                if (!password || password !== password2) {
                  setAuthError("パスワードが一致しません");
                  return;
                }
                if (!passwordRegex.test(password)) {
                  setAuthError(
                    "パスワードは8文字以上で、大文字、小文字、数字をそれぞれ1つ以上含める必要があります。"
                  );
                  return;
                }
                setAuthError(null);
                setAuthBusy(true);
                try {
                  const supabase = getSupabaseBrowser();
                  // Determine redirect base origin (strip path if env has one)
                  let origin =
                    process.env.NEXT_PUBLIC_APP_URL ||
                    (typeof window !== "undefined"
                      ? window.location.origin
                      : undefined);
                  try {
                    if (origin) origin = new URL(origin).origin;
                  } catch {}
                  const { error } = await supabase.auth.signUp({
                    email: (sub.email || email).trim(),
                    password,
                    options: origin
                      ? { emailRedirectTo: `${origin}/auth/callback` }
                      : undefined,
                  });
                  if (error) throw error;
                  setAuthStage("emailSent");
                } catch (err) {
                  setAuthError(
                    err instanceof Error ? err.message : "登録に失敗しました"
                  );
                } finally {
                  setAuthBusy(false);
                }
              }}
              onForgot={async () => {
                setAuthError(null);
                setAuthBusy(true);
                try {
                  const supabase = getSupabaseBrowser();
                  let origin =
                    process.env.NEXT_PUBLIC_APP_URL ||
                    (typeof window !== "undefined"
                      ? window.location.origin
                      : undefined);
                  try {
                    if (origin) origin = new URL(origin).origin;
                  } catch {}
                  const { error } = await supabase.auth.resetPasswordForEmail(
                    (sub.email || email).trim(),
                    origin
                      ? { redirectTo: `${origin}/auth/callback` }
                      : undefined
                  );
                  if (error) throw error;
                  setAuthStage("emailSent");
                } catch (err) {
                  setAuthError(
                    err instanceof Error
                      ? err.message
                      : "メール送信に失敗しました"
                  );
                } finally {
                  setAuthBusy(false);
                }
              }}
            />
          </div>
        )}

        {sub && !sub.current_plan && !sub.is_trialing && (
          <Card className="rounded-2xl border-0 shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-xl">
                契約情報が見つかりませんでした
              </CardTitle>
              <CardDescription>{sub.email || email}</CardDescription>
            </CardHeader>
            <CardContent>
              <NoSubscription onReset={() => setSub(null)} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

type AuthGateProps = {
  stage: null | "login" | "register" | "emailSent";
  busy: boolean;
  error: string | null;
  email: string;
  password: string;
  password2: string;
  onChangePassword: (v: string) => void;
  onChangePassword2: (v: string) => void;
  onLogin: () => void | Promise<void>;
  onRegister: () => void | Promise<void>;
  onForgot: () => void | Promise<void>;
  onReset: () => void;
};

function AuthGate({
  stage,
  busy,
  error,
  email,
  password,
  password2,
  onChangePassword,
  onChangePassword2,
  onLogin,
  onRegister,
  onForgot,
  onReset,
}: AuthGateProps) {
  const [showPassword, setShowPassword] = useState(false);
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

  if (stage === "emailSent") {
    return (
      <Card className="rounded-2xl border-0 shadow-md">
        <CardHeader>
          <CardTitle className="text-xl">確認メールを送信しました</CardTitle>
          <CardDescription>
            {email}{" "}
            宛に送信された確認リンクをクリックして、パスワード登録を完了してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={onReset}>
              戻る
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (stage === "register") {
    return (
      <Card className="rounded-2xl border-0 shadow-md">
        <CardHeader>
          <CardTitle className="text-xl">パスワードを設定</CardTitle>
          <CardDescription>
            {email}{" "}
            のアカウントを作成します。パスワード設定後、メールに届く確認リンクのクリックで登録・サインインが完了します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pw1">パスワード</Label>
              <div className="relative">
                <Input
                  id="pw1"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => onChangePassword(e.target.value)}
                  disabled={busy}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute inset-y-0 right-0 flex items-center px-3"
                  onClick={() => setShowPassword((prev) => !prev)}
                  disabled={busy}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-500" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-500" />
                  )}
                </Button>
              </div>
              <p className="text-sm text-gray-500">
                パスワードは8文字以上で、大文字、小文字、数字をそれぞれ1つ以上含める必要があります。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw2">パスワード（確認）</Label>
              <div className="relative">
                <Input
                  id="pw2"
                  type={showPassword ? "text" : "password"}
                  value={password2}
                  onChange={(e) => onChangePassword2(e.target.value)}
                  disabled={busy}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute inset-y-0 right-0 flex items-center px-3"
                  onClick={() => setShowPassword((prev) => !prev)}
                  disabled={busy}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-500" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-500" />
                  )}
                </Button>
              </div>
            </div>
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={onReset} disabled={busy}>
                戻る
              </Button>
              <Button
                onClick={onRegister}
                disabled={
                  busy ||
                  !password ||
                  password !== password2 ||
                  !passwordRegex.test(password)
                }
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 送信中...
                  </>
                ) : (
                  "メールで登録を確定"
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (stage === "login") {
    return (
      <Card className="rounded-2xl border-0 shadow-md">
        <CardHeader>
          <CardTitle className="text-xl">ログイン</CardTitle>
          <CardDescription>
            {email} のパスワードを入力してください
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">パスワード</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => onChangePassword(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 px-3 flex items-center"
                  aria-label={
                    showPassword ? "パスワードを非表示" : "パスワードを表示"
                  }
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-500" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-500" />
                  )}
                </button>
              </div>
            </div>{" "}
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={onReset} disabled={busy}>
                戻る
              </Button>
              <Button onClick={onLogin} disabled={busy || !password}>
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                    ログイン中...
                  </>
                ) : (
                  "ログイン"
                )}
              </Button>
            </div>
            <div className="text-right">
              <button
                type="button"
                className="text-sm text-blue-600 hover:underline"
                onClick={onForgot}
                disabled={busy}
              >
                パスワードをお忘れですか？
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // no stage (should not happen when gated)
  return null;
}

type ResolvedViewProps = {
  email: string;
  plan: Plan;
  productName?: string;
  unitAmount?: number;
  currency?: string;
  billingInterval?: "month" | "year";
  recipients?: RecipientInfo[];
  purchasedItems?: PurchasedItem[];
  onLogout: () => void | Promise<void>;
  onRefetch?: (targetEmail?: string) => void | Promise<void>;
  isTrialing?: boolean;
};

function ResolvedView({
  email,
  plan,
  productName,
  unitAmount,
  currency,
  billingInterval,
  recipients,
  purchasedItems,
  onLogout,
  onRefetch,
  isTrialing,
}: ResolvedViewProps) {
  const { toast } = useToast();
  const [recipientList, setRecipientList] = useState<RecipientInfo[]>(
    recipients ?? []
  );
  const [currentItems, setCurrentItems] = useState<PurchasedItem[]>(
    purchasedItems ?? []
  );
  const [currentProductName, setCurrentProductName] = useState<
    string | undefined
  >(productName);
  const [currentUnitAmount, setCurrentUnitAmount] = useState<
    number | undefined
  >(unitAmount);
  const [currentCurrency, setCurrentCurrency] = useState<string | undefined>(
    currency
  );
  const [currentBillingInterval, setCurrentBillingInterval] = useState<
    "month" | "year" | undefined
  >(billingInterval);

  useEffect(() => {
    setRecipientList(recipients ?? []);
  }, [recipients]);

  useEffect(() => {
    setCurrentItems(purchasedItems ?? []);
  }, [purchasedItems]);

  useEffect(() => {
    setCurrentProductName(productName);
  }, [productName]);

  useEffect(() => {
    setCurrentUnitAmount(unitAmount);
  }, [unitAmount]);

  useEffect(() => {
    setCurrentCurrency(currency);
  }, [currency]);

  useEffect(() => {
    setCurrentBillingInterval(billingInterval);
  }, [billingInterval]);

  const sortedRecipients = useMemo(() => {
    const unique = new Map<string, RecipientInfo>();
    for (const recipient of recipientList) {
      if (!recipient?.email) continue;
      const key = recipient.email.toLowerCase();
      const entry = unique.get(key);
      if (!entry) {
        unique.set(key, recipient);
        continue;
      }
      unique.set(key, {
        ...entry,
        created_via: entry.created_via ?? recipient.created_via ?? null,
        is_owner: entry.is_owner || recipient.is_owner,
        pending_removal: entry.pending_removal || recipient.pending_removal,
      });
    }

    const rank = (r: RecipientInfo) => {
      if (r.is_owner) return 0; // 契約者
      const via = (r.created_via ?? "").toLowerCase();
      if (via === "addon") return 2; // 追加登録（最後）
      return 1; // ラベル無し
    };

    return Array.from(unique.values()).sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.email.localeCompare(b.email);
    });
  }, [recipientList]);

  const addonRecipients = useMemo(
    () =>
      sortedRecipients.filter(
        (recipient) =>
          !recipient.is_owner &&
          (recipient.created_via ?? "").toLowerCase() === "addon"
      ),
    [sortedRecipients]
  );

  const displayItems = currentItems.length
    ? currentItems
    : currentProductName
    ? [
        {
          name: currentProductName,
          quantity: 1,
          type: "base" as const,
        },
      ]
    : [];

  const manageUrl =
    process.env.NEXT_PUBLIC_STRIPE_SUBSCRIPTION_MANAGE_URL || "";

  if (isTrialing) {
    return (
      <Card className="rounded-2xl border-0 shadow-md">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-3">
              <h3 className="border-b border-gray-200 pb-2 text-xl font-semibold text-gray-900">
                現在の契約プラン
              </h3>
              <div className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-900">
                <span>
                  {process.env.NEXT_PUBLIC_TRIAL_PLAN_NAME ||
                    "無料トライアル (30日)"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onLogout}>
                ログアウト
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-12">
          <section className="space-y-4">
            <h3 className="border-b border-gray-200 pb-2 text-xl font-semibold text-gray-900">
              プランを選択
            </h3>
            <div>
              <Script
                async
                src="https://js.stripe.com/v3/pricing-table.js"
              ></Script>
              <stripe-pricing-table
                pricing-table-id="prctbl_1SAk6HF6twdam0Y4fZYQNW30"
                publishable-key="pk_test_51S5P4VF6twdam0Y43oSJhGvWBKOk2aWe1eWJQ0n3wLGhVuHkkuAMKSZr5jWqY3UXHcKC92rQ91h5O4rTXwF4umdr00tbXvEh7x"
              ></stripe-pricing-table>
            </div>
          </section>
          <section className="space-y-4">
            <h3 className="border-b border-gray-200 pb-2 text-xl font-semibold text-gray-900">
              サブスクリプションの管理
            </h3>
            <div className="space-y-2 rounded-md bg-gray-50 p-4 text-sm text-gray-600">
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  サブスクリプションの解約
                  <ul className="list-none">
                    <li>
                      プラン変更をご希望の場合は、一度現在のサブスクリプションを解約し、
                      新しいプランを購入してください。
                    </li>
                  </ul>
                </li>
                <li>請求書・領収書ダウンロード</li>
                <li>請求履歴の確認</li>
                <li>請求先情報の確認・更新</li>
              </ul>
            </div>
            <PortalButton email={email} />
          </section>
        </CardContent>
      </Card>
    );
  }

  if (plan === null) {
    return (
      <Card className="rounded-2xl border-0 shadow-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-xl">
            契約情報が見つかりませんでした
          </CardTitle>
          <CardDescription>{email}</CardDescription>
        </CardHeader>
        <CardContent>
          <NoSubscription />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border-0 shadow-md">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <h3 className="border-b border-gray-200 pb-2 text-xl font-semibold text-gray-900">
              現在の契約プラン
            </h3>
            {displayItems.length > 0 ? (
              <ul className="space-y-1 text-sm text-gray-900">
                {displayItems.map((item) => (
                  <li
                    key={`${item.product_id ?? item.name}-${
                      item.price_id ?? item.name
                    }`}
                    className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2"
                  >
                    <span>{item.name}</span>
                    <span className="ml-2 text-gray-600">×{item.quantity}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-600">
                {currentProductName ||
                  (plan === "lite" ? "Liteプラン" : "Businessプラン")}
              </p>
            )}
            {/* Email hidden per request */}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onLogout}>
              ログアウト
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-12">
        <section className="space-y-4">
          <h3 className="border-b border-gray-200 pb-2 text-xl font-semibold text-gray-900">
            現在の配信先
          </h3>
          {sortedRecipients.length > 0 ? (
            <ul className="space-y-2 text-gray-700">
              {sortedRecipients.map((recipient) => (
                <li
                  key={recipient.email}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                >
                  <span>
                    {recipient.email}
                    {recipient.pending_removal ? (
                      <span className="ml-2 text-xs text-red-600">
                        （削除予定）
                      </span>
                    ) : null}
                  </span>
                  <div className="flex items-center gap-2">
                    {recipient.is_owner && (
                      <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                        契約者
                      </span>
                    )}
                    {!recipient.is_owner &&
                      (recipient.created_via ?? "").toLowerCase() ===
                        "addon" && (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
                          追加登録
                        </span>
                      )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-600">
              登録済みのメールアドレスはまだありません。
            </p>
          )}
        </section>

        <section className="space-y-4">
          <h3 className="border-b border-gray-200 pb-2 text-xl font-semibold text-gray-900">
            配信先の操作
          </h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <AddRecipientsModal
              email={email}
              plan={plan}
              unitAmount={currentUnitAmount}
              currency={currentCurrency}
              billingInterval={currentBillingInterval}
              existingRecipients={sortedRecipients}
              onRefetch={() => onRefetch?.(email)}
            />
            <EditRecipientModal
              ownerEmail={email}
              addonRecipients={addonRecipients}
              onSuccess={setRecipientList}
            />
            <DeleteRecipientsModal
              ownerEmail={email}
              addonRecipients={addonRecipients}
              onSuccess={setRecipientList}
            />
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="border-b border-gray-200 pb-2 text-xl font-semibold text-gray-900">
            サブスクリプションの管理
          </h3>
          <div className="space-y-2 rounded-md bg-gray-50 p-4 text-sm text-gray-600">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                サブスクリプションの解約
                <ul className="list-none">
                  <li>
                    プラン変更をご希望の場合は、一度現在のサブスクリプションを解約し、
                    新しいプランを購入してください。
                  </li>
                </ul>
              </li>
              <li>請求書・領収書ダウンロード</li>
              <li>請求履歴の確認</li>
              <li>請求先情報の確認・更新</li>
            </ul>
          </div>
          <PortalButton email={email} />
        </section>
      </CardContent>
    </Card>
  );
}

type AddRecipientsModalProps = {
  email: string;
  plan: Plan;
  unitAmount?: number;
  currency?: string;
  billingInterval?: "month" | "year";
  existingRecipients: RecipientInfo[];
  onRefetch?: () => void | Promise<void>;
};

function AddRecipientsModal({
  email,
  plan,
  unitAmount,
  currency,
  billingInterval,
  existingRecipients,
  onRefetch,
}: AddRecipientsModalProps) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(1);
  const [countInput, setCountInput] = useState("1");
  const [emails, setEmails] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [postUpdateOpen, setPostUpdateOpen] = useState(false);
  const [updatedProductName, setUpdatedProductName] = useState<string>("");
  const [updatedQuantity, setUpdatedQuantity] = useState<number>(0);
  const [portalUrl, setPortalUrl] = useState<string>("");
  const [postCheckoutOpen, setPostCheckoutOpen] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string>("");
  const [suspendReset, setSuspendReset] = useState(false);
  const [prechecking, setPrechecking] = useState(false);
  const [awaitingCheckoutRedirect, setAwaitingCheckoutRedirect] =
    useState(false);

  const isFirstTimeAddonPurchase = useMemo(
    () =>
      existingRecipients.filter(
        (r) => !r.is_owner && (r.created_via ?? "").toLowerCase() === "addon"
      ).length === 0,
    [existingRecipients]
  );

  useEffect(() => {
    if (!open && !suspendReset) {
      setCount(1);
      setCountInput("1");
      setEmails([""]);
      setError(null);
      setSaving(false);
    }
  }, [open, suspendReset]);

  useEffect(() => {
    setEmails((prev) => {
      const next = prev.slice(0, count);
      while (next.length < count) {
        next.push("");
      }
      return next;
    });
  }, [count]);

  const normalizedExisting = useMemo(() => {
    const set = new Set<string>();
    existingRecipients.forEach((recipient) => {
      if (recipient.email) {
        set.add(recipient.email.toLowerCase());
      }
    });
    set.add(email.toLowerCase());
    return set;
  }, [existingRecipients, email]);

  const normalizedNewEmails = useMemo(
    () => emails.map((value) => value.trim().toLowerCase()).filter(Boolean),
    [emails]
  );

  const hasExistingDuplicate = normalizedNewEmails.some((value) =>
    normalizedExisting.has(value)
  );
  const hasInternalDuplicate =
    new Set(normalizedNewEmails).size !== normalizedNewEmails.length;

  const handleCountChange = (value: string) => {
    const digits = value.replace(/[^0-9]/g, "");
    if (digits === "") {
      setCountInput("");
      return; // 入力編集中は空文字を許容
    }
    const n = parseInt(digits, 10);
    if (Number.isNaN(n)) {
      setCountInput("");
      return;
    }
    if (n > MAX_ADDITIONAL_RECIPIENTS) {
      setCount(MAX_ADDITIONAL_RECIPIENTS);
      setCountInput(String(MAX_ADDITIONAL_RECIPIENTS));
      return;
    }
    setCountInput(digits);
    const clampedMin = Math.max(1, n);
    setCount(clampedMin);
  };

  const updateEmail = (index: number, value: string) => {
    setEmails((prev) =>
      prev.map((current, idx) => (idx === index ? value : current))
    );
  };

  const canSubmit =
    normalizedNewEmails.length === count &&
    !hasExistingDuplicate &&
    !hasInternalDuplicate &&
    !saving &&
    !prechecking;

  const handleOpenConfirm = async () => {
    if (!canSubmit) return;

    setError(null);
    setCheckoutUrl("");
    setAwaitingCheckoutRedirect(false);

    try {
      setPrechecking(true);
      const payload = emails.map((v) => v.trim()).filter(Boolean);
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          quantity: count,
          ownerEmail: email,
          additionalEmails: payload,
          precheck: true,
        }),
      });
      const data = await res.json();

      if (data?.canFinalizeSilently) {
        // Silent purchase is possible
        setAwaitingCheckoutRedirect(false);
      } else if (data?.url) {
        // Redirect is necessary
        setCheckoutUrl(String(data.url));
        setAwaitingCheckoutRedirect(true);
      } else {
        // Handle error case
        throw new Error(data?.error || "確認中にエラーが発生しました。");
      }

      setSuspendReset(true);
      setOpen(false);
      setConfirmOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setPrechecking(false);
    }
  };

  const performPurchase = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = emails.map((value) => value.trim()).filter(Boolean);
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: plan,
          quantity: count,
          ownerEmail: email,
          additionalEmails: payload,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Checkoutの作成に失敗しました");
      }
      const data = await res.json();
      if (data?.updated && data?.portalUrl) {
        const d = data as Record<string, unknown>;
        setUpdatedProductName(String(d.productName ?? "配信先追加"));
        setUpdatedQuantity(Number(d.newQuantity ?? count));
        setPortalUrl(String(d.portalUrl));
        setPostUpdateOpen(true);
        setSuspendReset(false);
        setOpen(false);
      } else {
        throw new Error(
          data?.error ||
            "予期せぬエラーが発生しました。再読み込みしてお試しください。"
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button className="w-full">追加</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              配信先を追加する
            </DialogTitle>
            <DialogDescription>
              新しく配信先に追加するメールアドレスを入力してください。
              {awaitingCheckoutRedirect && (
                <>
                  <br />
                  サブスクリプション購入画面で購入を確定してください
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {typeof unitAmount !== "undefined" && (
              <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
                追加料金（{billingInterval === "year" ? "年額" : "月額"}）：
                {formatCurrency(unitAmount, currency)} ／ 1メールアドレス
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="addon-count">
                追加するメールアドレス数（最大{MAX_ADDITIONAL_RECIPIENTS}件）
              </Label>
              <Input
                id="addon-count"
                type="number"
                min={1}
                max={MAX_ADDITIONAL_RECIPIENTS}
                step={1}
                value={countInput}
                onChange={(event) => handleCountChange(event.target.value)}
                disabled={prechecking || saving}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => {
                  if (countInput === "") {
                    setCount(1);
                    setCountInput("1");
                    return;
                  }
                  const n = parseInt(countInput, 10);
                  const clamped = Math.min(
                    MAX_ADDITIONAL_RECIPIENTS,
                    Math.max(1, Number.isNaN(n) ? 1 : n)
                  );
                  setCount(clamped);
                  if (String(clamped) !== countInput) {
                    setCountInput(String(clamped));
                  }
                }}
              />
            </div>
            <div className="space-y-3">
              <Label>追加するメールアドレス</Label>
              {emails.map((value, index) => (
                <Input
                  key={index}
                  type="email"
                  required
                  value={value}
                  onChange={(event) => updateEmail(index, event.target.value)}
                  placeholder={`example${index + 1}@email.com`}
                  disabled={prechecking || saving}
                />
              ))}
            </div>
            {(hasExistingDuplicate || hasInternalDuplicate) && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                既に登録済みのメールアドレスが含まれています。
              </div>
            )}
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={saving}>
                キャンセル
              </Button>
            </DialogClose>
            {/* ここをプリチェック起点に変更 */}
            <Button onClick={handleOpenConfirm} disabled={!canSubmit}>
              {prechecking ? ( // ★プリチェック中
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  確認中...
                </>
              ) : saving ? ( // （保険：同関数を使い回す場合）
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  保存中...
                </>
              ) : (
                "追加購入へ進む"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 確認ダイアログ */}
      <Dialog
        open={confirmOpen}
        onOpenChange={(v) => {
          setConfirmOpen(v);
          if (!v) {
            setAwaitingCheckoutRedirect(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              追加購入確定
            </DialogTitle>
            <DialogDescription className="mb-6 leading-relaxed">
              {formatCurrency((unitAmount || 0) * count, currency)}{" "}
              のサブスクリプション追加購入を確定します。
              {awaitingCheckoutRedirect && (
                <span className="mt-4 block text-sm text-muted-foreground">
                  サブスクリプション購入画面で購入を確定してください
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <Button
              variant="outline"
              onClick={() => {
                setConfirmOpen(false);
                setSuspendReset(false);
                setOpen(true); // reopen main modal when canceled
                setAwaitingCheckoutRedirect(false);
              }}
              disabled={saving}
            >
              キャンセル
            </Button>
            {awaitingCheckoutRedirect ? (
              <Button
                onClick={() => {
                  if (checkoutUrl) {
                    try {
                      window.location.href = checkoutUrl;
                    } catch {}
                  }
                }}
                disabled={saving || !checkoutUrl}
              >
                決済画面を開く
              </Button>
            ) : (
              <Button onClick={performPurchase} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 処理中...
                  </>
                ) : (
                  "OK"
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 追加購入完了ダイアログ（1回目/2回目以降 共通） */}
      <Dialog open={postUpdateOpen} onOpenChange={setPostUpdateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              追加購入が完了しました
            </DialogTitle>
            <DialogDescription className="mb-6">
              {`「${updatedProductName} 」 の合計数量は 「 ${updatedQuantity} 」 になりました。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button
                variant="outline"
                onClick={() => {
                  try {
                    window.location.reload();
                  } catch {}
                }}
              >
                閉じる
              </Button>
            </DialogClose>
            {portalUrl ? (
              <Button asChild>
                <a href={portalUrl} target="_blank" rel="noopener noreferrer">
                  管理画面で確認
                </a>
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新規購入案内ダイアログ（別タブ用フォールバック） */}
      <Dialog open={postCheckoutOpen} onOpenChange={setPostCheckoutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              購入ページを開きました
            </DialogTitle>
            <DialogDescription>
              サブスクリプションの購入ページを別タブで開きます。決済完了後に本画面へお戻りください。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">閉じる</Button>
            </DialogClose>
            {checkoutUrl ? (
              <Button asChild>
                <a href={checkoutUrl} target="_blank" rel="noopener noreferrer">
                  購入ページを開く
                </a>
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type EditRecipientModalProps = {
  ownerEmail: string;
  addonRecipients: RecipientInfo[];
  onSuccess: (recipients: RecipientInfo[]) => void;
};

function EditRecipientModal({
  ownerEmail,
  addonRecipients,
  onSuccess,
}: EditRecipientModalProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<string>("");
  const [nextEmail, setNextEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const selectableRecipients = useMemo(
    () => addonRecipients.filter((recipient) => !recipient.pending_removal),
    [addonRecipients]
  );

  useEffect(() => {
    if (open) {
      setSelectedEmail(selectableRecipients[0]?.email ?? "");
    } else {
      setNextEmail("");
      setError(null);
      setSaving(false);
    }
  }, [open, selectableRecipients]);

  const handleSubmit = async () => {
    if (!selectedEmail || !nextEmail.trim()) {
      setError("新しいメールアドレスを入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/recipients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerEmail,
          fromEmail: selectedEmail,
          toEmail: nextEmail.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "メールアドレスの変更に失敗しました");
      }
      const data = await res.json();
      if (Array.isArray(data?.recipients)) {
        onSuccess(data.recipients as RecipientInfo[]);
      }
      toast({ title: "メールアドレスを変更しました" });
      setDone(true);
      setTimeout(() => {
        setOpen(false);
        setDone(false);
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full" disabled={!selectableRecipients.length}>
          変更
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            配信先を変更する
          </DialogTitle>
          <DialogDescription>
            変更できるのは追加登録されたメールアドレスのみです。
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {done && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
              変更が完了しました。
            </div>
          )}
          {selectableRecipients.length === 0 ? (
            <p className="text-sm text-gray-600">
              変更可能なメールアドレスがありません。
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="edit-target">変更するメールアドレス</Label>
                <select
                  id="edit-target"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={selectedEmail}
                  onChange={(event) => setSelectedEmail(event.target.value)}
                >
                  {selectableRecipients.map((recipient) => (
                    <option key={recipient.email} value={recipient.email}>
                      {recipient.email}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-next">新しいメールアドレス</Label>
                <Input
                  id="edit-next"
                  type="email"
                  value={nextEmail}
                  onChange={(event) => setNextEmail(event.target.value)}
                  required
                />
              </div>
            </>
          )}
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={saving}>
              キャンセル
            </Button>
          </DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={saving || !selectableRecipients.length}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 保存中...
              </>
            ) : (
              "変更する"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type DeleteRecipientsModalProps = {
  ownerEmail: string;
  addonRecipients: RecipientInfo[];
  manageUrl?: string;
  onSuccess: (recipients: RecipientInfo[]) => void;
};

function DeleteRecipientsModal({
  ownerEmail,
  addonRecipients,
  onSuccess,
}: DeleteRecipientsModalProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMarked, setHasMarked] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [postDeleteOpen, setPostDeleteOpen] = useState(false);
  const [skipResetOnce, setSkipResetOnce] = useState(false);
  const [portalUrl, setPortalUrl] = useState<string>("");
  const [isCancellingSubscription, setIsCancellingSubscription] =
    useState(false);

  const isDeletingAllAddonRecipients =
    addonRecipients.length > 0 && selected.size === addonRecipients.length;

  useEffect(() => {
    if (!open) {
      if (confirmDeleteOpen || postDeleteOpen) return; // ← ガード
      if (skipResetOnce) {
        setSkipResetOnce(false);
        return;
      }
      setPendingEmail(null);
      setError(null);
      setHasMarked(false);
      setSelected(new Set());
      setPortalUrl("");
      setIsCancellingSubscription(false);
    }
  }, [open, skipResetOnce, confirmDeleteOpen, postDeleteOpen]);

  const quantityChangeEnabled = useMemo(
    () =>
      hasMarked ||
      addonRecipients.some((recipient) => recipient.pending_removal),
    [hasMarked, addonRecipients]
  );

  const toggleSelect = (email: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const handleCommitDelete = async () => {
    const emails = Array.from(selected);
    if (emails.length === 0) return;
    setPendingEmail("__batch__");
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/recipients", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerEmail, emails }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "メールアドレスの削除に失敗しました");
      }
      const data = await res.json();
      if (Array.isArray(data?.recipients)) {
        onSuccess(data.recipients as RecipientInfo[]);
      }
      // ★ portalUrl を API レスポンスから取得
      if (data && typeof data === "object" && "portalUrl" in data) {
        const p = String((data as Record<string, unknown>).portalUrl || "");
        setPortalUrl(p);
      }
      setHasMarked(true);
      setSelected(new Set());
      toast({ title: "選択した配信先を削除しました" });
      setConfirmDeleteOpen(false);
      setOpen(false);
      setPostDeleteOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setPendingEmail(null);
      setDeleting(false);
    }
  };

  const handleManageClick = () => {
    toast({
      title: "数量の自動反映について",
      description:
        "削除予約に応じてサブスクリプションの数量は自動で調整されています。管理画面の操作は不要です。",
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button className="w-full" disabled={addonRecipients.length === 0}>
            削除
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              配信先を削除する
            </DialogTitle>
            <DialogDescription>
              削除できるのは追加登録されたメールアドレスのみです。
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {addonRecipients.length === 0 ? (
              <p className="text-sm text-gray-600">
                削除可能なメールアドレスがありません。
              </p>
            ) : (
              <ul className="space-y-2">
                {addonRecipients.map((recipient) => (
                  <li
                    key={recipient.email}
                    className={`flex items-center justify-between rounded-lg border bg-white px-3 py-2 text-sm ${
                      selected.has(recipient.email)
                        ? "border-red-300 bg-red-50"
                        : "border-gray-200"
                    }`}
                  >
                    <div>
                      {recipient.email}
                      {recipient.pending_removal ? (
                        <span className="ml-2 text-xs text-red-600">
                          （削除予約済み）
                        </span>
                      ) : selected.has(recipient.email) ? (
                        <span className="ml-2 text-xs text-red-600">
                          （削除選択中）
                        </span>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={
                        Boolean(recipient.pending_removal) ||
                        Boolean(pendingEmail)
                      }
                      onClick={() => toggleSelect(recipient.email)}
                      aria-label={`${recipient.email} を削除対象に切り替え`}
                    >
                      {selected.has(recipient.email) ? (
                        "選択解除"
                      ) : (
                        <span className="text-lg">×</span>
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={Boolean(pendingEmail)}>
                閉じる
              </Button>
            </DialogClose>
            <Button
              variant="outline"
              onClick={() => {
                setIsCancellingSubscription(isDeletingAllAddonRecipients);
                setSkipResetOnce(true);
                setConfirmDeleteOpen(true); // 先に true にする
                setOpen(false); // 後から親を閉じる
              }}
              disabled={selected.size === 0 || Boolean(pendingEmail)}
            >
              選択した配信先を削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 削除確認モーダル */}
      <Dialog
        open={confirmDeleteOpen}
        onOpenChange={(v) => {
          setConfirmDeleteOpen(v);
          if (!v && !postDeleteOpen) setOpen(true);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">削除確認</DialogTitle>
            <DialogDescription className="mb-6">
              {isDeletingAllAddonRecipients ? (
                "全ての配信先を削除します。配信先追加のサブスクリプションがキャンセルされます。"
              ) : (
                <>
                  選択した {selected.size} 件の配信先を削除します。
                  <br />
                  サブスクリプションの数量が {selected.size}{" "}
                  件マイナスされます。
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <Button
              variant="outline"
              onClick={() => {
                setConfirmDeleteOpen(false);
                setOpen(true);
              }}
              disabled={deleting}
            >
              キャンセル
            </Button>
            <Button onClick={handleCommitDelete} disabled={deleting}>
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 処理中...
                </>
              ) : (
                "削除"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 削除完了モーダル */}
      <Dialog open={postDeleteOpen} onOpenChange={setPostDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              削除が完了しました
            </DialogTitle>
            <DialogDescription className="mb-6">
              {isCancellingSubscription
                ? "配信先の削除とサブスクリプションキャンセルが完了しました。"
                : "選択した配信先の削除とサブスクリプション数量変更が完了しました。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button
                variant="outline"
                onClick={() => {
                  try {
                    window.location.reload();
                  } catch {}
                }}
              >
                閉じる
              </Button>
            </DialogClose>

            {/* ★ ここを portalUrl のみで表示。フォールバックは使わない */}
            {portalUrl && (
              <Button asChild>
                <a href={portalUrl} target="_blank" rel="noopener noreferrer">
                  管理画面で確認
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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

function NoSubscription({ onReset }: { onReset?: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-gray-700">
        購入履歴がありません。トップページからサブスクリプションを購入できます。
      </p>
      <Button asChild className="w-full">
        <a href="/">トップページへ</a>
      </Button>
      {onReset ? (
        <Button variant="outline" onClick={onReset} className="w-full">
          メールアドレス入力画面へ
        </Button>
      ) : null}
    </div>
  );
}
