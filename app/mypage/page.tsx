"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Script from "next/script";
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
import { toJapaneseAuthErrorMessage } from "@/lib/auth-errors";
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
} from "@/components/ui/dialog";

// Utility function to format date in Japanese long format
function formatDateJPLong(dateString?: string): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date);
  } catch {
    return "";
  }
}

// Component to display when no subscription is found
function NoSubscription() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        現在、有効なサブスクリプションがありません。
      </p>
      <div>
        <script async src="https://js.stripe.com/v3/pricing-table.js"></script>
        <stripe-pricing-table
          pricing-table-id="prctbl_1SKADY5wfsh1mLQsvTAi9isM"
          publishable-key="pk_test_51SEPyP5wfsh1mLQsYLJTHeQWuk8l9iaZgi9NuF81nQZ5b7aQT4THbMxA6Fy5EsKjXN06IaBUoTtGjO3wZirwY0to00PDQybv07"
        ></stripe-pricing-table>
      </div>
    </div>
  );
}

const MAX_ADDITIONAL_RECIPIENTS = 10;
const SESSION_EMAIL_KEY = "mypage:lastEmail:session";

type Plan = "lite" | "business" | "trial" | null;

type RecipientInfo = {
  email: string;
  created_via: "initial" | "addon" | null;
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
  trial_ends_at?: string;
}

export default function MyPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sub, setSub] = useState<SubscriptionData | null>(null);
  const [booting, setBooting] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [authStage, setAuthStage] = useState<
    null | "login" | "register" | "emailSent"
  >(null);
  // ログイン/登録の進行状態
  const [authBusy, setAuthBusy] = useState(false);
  // 「パスワードをお忘れの方」押下時の進行状態（ログインボタンの見た目に影響しないよう分離）
  const [forgotBusy, setForgotBusy] = useState(false);
  // 認証メール再送の進行状態
  const [resendBusy, setResendBusy] = useState(false);
  // emailSent の用途（signup or reset）
  const [emailSentType, setEmailSentType] = useState<"signup" | "reset" | null>(
    null
  );
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [emailNotConfirmed, setEmailNotConfirmed] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  // 枠情報（ベース/追加/使用/残り）
  const [recipLimits, setRecipLimits] = useState<{
    plan: Plan;
    base_slots: number;
    addon_slots: number;
    used_slots: number;
    remaining_slots: number;
  } | null>(null);

  const loadLimits = async (targetEmail: string) => {
    try {
      const res = await fetch(
        `/api/me/limits?email=${encodeURIComponent(targetEmail)}`
      );
      if (!res.ok) throw new Error("limits fetch failed");
      const data = await res.json();
      setRecipLimits(data);
    } catch {
      setRecipLimits(null);
    }
  };

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
      if (!res.ok) throw new Error("契約情報の取得に失敗しました。");
      const data = (await res.json()) as SubscriptionData;
      setSub(data);
      setError(null);
      // 枠情報の取得（lite/business のみ）
      if (data.current_plan === "lite" || data.current_plan === "business") {
        loadLimits(e);
      } else {
        setRecipLimits(null);
      }

      // 認証チェック: 有料プラン(Lite/Business)のみ認証フローへ
      try {
        const hasPaidPlan =
          data.current_plan === "lite" || data.current_plan === "business";
        if (hasPaidPlan) {
          const supabase = getSupabaseBrowser();
          const { data: sessionRes } = await supabase.auth.getUser();
          const authedEmail = sessionRes.user?.email?.toLowerCase();
          if (authedEmail && authedEmail === e.toLowerCase()) {
            setIsAuthed(true);
            setAuthStage(null);
          } else {
            setIsAuthed(false);
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
      setError(
        err instanceof Error ? err.message : "不明なエラーが発生しました。"
      );
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
    // If no last session email, try to prefill from Supabase session
    (async () => {
      try {
        if (sub) return;
        const supabase = getSupabaseBrowser();
        const { data } = await supabase.auth.getUser();
        const authedEmail = data.user?.email?.toLowerCase();
        if (authedEmail && !email) {
          setEmail(authedEmail);
          setBooting(true);
          refreshByEmail(authedEmail);
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (booting && !loading) {
      setBooting(false);
    }
  }, [booting, loading]);

  // クエリパラメータのサクセスメッセージ表示とクエリ除去はクライアント副作用で行う
  useEffect(() => {
    if (typeof window === "undefined") return;
    const welcome = search?.get("welcome");
    const reset = search?.get("reset");
    const resetErr = search?.get("reset_error");
    const authErr = search?.get("auth_error");
    if (welcome) {
      toast({
        title: "アカウント作成が完了しました",
        description: "マイページにログインしました。",
      });
    }
    if (reset) {
      toast({
        title: "パスワードを更新しました",
        description: "新しいパスワードでログインできます。",
      });
    }
    if (resetErr) {
      // 失効・未セッションいずれでも、指定文言を表示
      toast({
        title: "認証セッションが見つかりません。メールを再送してください。",
      });
    }
    if (authErr) {
      // lib/auth-errors.ts のマッピングを優先し、足りないコード系は簡易判定で補完
      const raw = String(authErr);
      const fallback = "エラーが発生しました。時間をおいて再度お試しください。";
      let msg = toJapaneseAuthErrorMessage(raw, fallback);
      const v = raw.toLowerCase();
      // 明示コードや断片からの補完（期限切れなど）
      if (
        msg === fallback &&
        (v.includes("otp_expired") ||
          v.includes("expired") ||
          v.includes("invalid or expired"))
      ) {
        msg = "URLの有効期限が切れているか無効です。メールを再送してください。";
      }
      if (msg === fallback && v.includes("auth_session_missing")) {
        msg = "認証セッションが見つかりません。メールを再送してください。";
      }
      toast({ title: msg });
    }
    if (welcome || reset || resetErr || authErr) {
      const sp = new URLSearchParams(window.location.search);
      sp.delete("welcome");
      sp.delete("reset");
      sp.delete("reset_error");
      sp.delete("auth_error");
      const next = `${window.location.pathname}${
        sp.toString() ? `?${sp.toString()}` : ""
      }`;
      router.replace(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

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
      if (!res.ok) throw new Error("契約情報の取得に失敗しました。");
      const data = (await res.json()) as SubscriptionData;
      setSub(data);

      // 枠情報の取得（lite/business のみ）
      if (data.current_plan === "lite" || data.current_plan === "business") {
        loadLimits(email.trim());
      } else {
        setRecipLimits(null);
      }

      try {
        const hasPaidPlan =
          data.current_plan === "lite" || data.current_plan === "business";
        if (hasPaidPlan) {
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
      setError(
        err instanceof Error ? err.message : "不明なエラーが発生しました。"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div
        className={`mx-auto ${sub?.is_trialing ? "max-w-5xl" : "max-w-3xl"}`}
      >
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-3xl font-bold text-gray-900">
            マイページ（有料プランユーザー限定）
          </h1>
        </div>
        {/* 成功メッセージは useEffect で処理済み */}

        {!sub &&
          (!hydrated ? (
            <div />
          ) : booting ? (
            <Card className="mb-6 rounded-2xl border-0 shadow-md">
              <CardHeader>
                <CardTitle className="text-xl">読み込み中...</CardTitle>
                <CardDescription>契約状況を取得しています。</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center py-6 text-gray-600">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="mb-6 rounded-2xl border-0 shadow-md">
              <CardHeader>
                <CardTitle className="text-xl">
                  ご契約メールアドレスを入力
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCheck} className="space-y-4">
                  <div className="space-y-2">
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
                        Loading...
                      </>
                    ) : (
                      "マイページへ"
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}

        {sub &&
          isAuthed &&
          (sub.current_plan === "lite" || sub.current_plan === "business") && (
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
              trialEndsAt={sub.trial_ends_at}
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
              recipLimits={recipLimits}
            />
          )}

        {sub &&
          !isAuthed &&
          (sub.current_plan === "lite" || sub.current_plan === "business") && (
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
                  setForgotBusy(false);
                  setResendBusy(false);
                  setEmailNotConfirmed(false);
                  setEmailSentType(null);
                }}
                onLogin={async () => {
                  setAuthError(null);
                  setEmailNotConfirmed(false);
                  setAuthBusy(true);
                  try {
                    const supabase = getSupabaseBrowser();
                    const { error } = await supabase.auth.signInWithPassword({
                      email: (sub.email || email).trim(),
                      password,
                    });
                    if (error) throw error;
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
                      setAuthError(
                        "ログインしたユーザーのメールが一致しません。"
                      );
                    }
                  } catch (err) {
                    const { toJapaneseAuthErrorMessage } = await import(
                      "@/lib/auth-errors"
                    );
                    setAuthError(
                      toJapaneseAuthErrorMessage(
                        err,
                        "ログインに失敗しました。"
                      )
                    );
                    try {
                      const { isEmailNotConfirmedError } = await import(
                        "@/lib/auth-errors"
                      );
                      setEmailNotConfirmed(isEmailNotConfirmedError(err));
                    } catch {}
                  } finally {
                    setAuthBusy(false);
                  }
                }}
                onRegister={async () => {
                  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
                  if (!password || password !== password2) {
                    setAuthError("パスワードが一致しません。");
                    return;
                  }
                  if (!passwordRegex.test(password)) {
                    setAuthError(
                      "パスワードは8文字以上・大小英字と数字を各1文字以上含めてください。"
                    );
                    return;
                  }
                  setAuthError(null);
                  setAuthBusy(true);
                  try {
                    const supabase = getSupabaseBrowser();
                    let origin =
                      (typeof window !== "undefined"
                        ? window.location.origin
                        : undefined) || process.env.NEXT_PUBLIC_APP_URL;
                    try {
                      if (origin) origin = new URL(origin).origin;
                    } catch {}
                    const { error } = await supabase.auth.signUp({
                      email: (sub.email || email).trim(),
                      password,
                      options: origin
                        ? {
                            emailRedirectTo: `${origin}/auth/callback?flow=signup`,
                          }
                        : undefined,
                    });
                    if (error) throw error;
                    setEmailSentType("signup");
                    setAuthStage("emailSent");
                  } catch (err) {
                    const { toJapaneseAuthErrorMessage } = await import(
                      "@/lib/auth-errors"
                    );
                    setAuthError(
                      toJapaneseAuthErrorMessage(err, "登録に失敗しました。")
                    );
                  } finally {
                    setAuthBusy(false);
                  }
                }}
                onForgot={async () => {
                  setAuthError(null);
                  setForgotBusy(true);
                  try {
                    const supabase = getSupabaseBrowser();
                    let origin =
                      (typeof window !== "undefined"
                        ? window.location.origin
                        : undefined) || process.env.NEXT_PUBLIC_APP_URL;
                    try {
                      if (origin) origin = new URL(origin).origin;
                    } catch {}
                    const { error } = await supabase.auth.resetPasswordForEmail(
                      (sub.email || email).trim(),
                      origin
                        ? {
                            redirectTo: `${origin}/auth/callback?flow=recovery`,
                          }
                        : undefined
                    );
                    if (error) throw error;
                    setEmailSentType("reset");
                    setAuthStage("emailSent");
                  } catch (err) {
                    const { toJapaneseAuthErrorMessage } = await import(
                      "@/lib/auth-errors"
                    );
                    setAuthError(
                      toJapaneseAuthErrorMessage(
                        err,
                        "パスワードリセットに失敗しました。"
                      )
                    );
                  } finally {
                    setForgotBusy(false);
                  }
                }}
                forgotBusy={forgotBusy}
                emailNotConfirmed={emailNotConfirmed}
                onResendSignup={async () => {
                  setAuthError(null);
                  setResendBusy(true);
                  try {
                    const supabase = getSupabaseBrowser();
                    let origin =
                      (typeof window !== "undefined"
                        ? window.location.origin
                        : undefined) || process.env.NEXT_PUBLIC_APP_URL;
                    try {
                      if (origin) origin = new URL(origin).origin;
                    } catch {}
                    const { error } = await supabase.auth.resend({
                      type: "signup",
                      email: (sub.email || email).trim(),
                      options: origin
                        ? {
                            emailRedirectTo: `${origin}/auth/callback?flow=signup`,
                          }
                        : undefined,
                    });
                    if (error) throw error;
                    setEmailSentType("signup");
                    setAuthStage("emailSent");
                  } catch (err) {
                    const { toJapaneseAuthErrorMessage } = await import(
                      "@/lib/auth-errors"
                    );
                    setAuthError(
                      toJapaneseAuthErrorMessage(
                        err,
                        "認証メールの再送に失敗しました。"
                      )
                    );
                  } finally {
                    setResendBusy(false);
                  }
                }}
                resendBusy={resendBusy}
                emailSentType={emailSentType}
              />
            </div>
          )}

        {sub &&
          !(sub.current_plan === "lite" || sub.current_plan === "business") && (
            <div className="mx-auto max-w-2xl">
              <Card className="rounded-2xl border-0 shadow-md">
                <CardHeader className="pb-3">
                  <CardTitle className="text-xl">
                    メールアドレスが正しくありません
                  </CardTitle>
                  <CardDescription>{sub.email || email}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <Button
                      variant="outline"
                      onClick={() => setSub(null)}
                      className="w-full"
                    >
                      メールアドレス入力に戻る
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
      </div>
    </div>
  );
}

/** ----------------- AuthGate ----------------- */

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
  forgotBusy?: boolean;
  emailNotConfirmed?: boolean;
  onResendSignup?: () => void | Promise<void>;
  resendBusy?: boolean;
  emailSentType?: "signup" | "reset" | null;
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
  forgotBusy,
  emailNotConfirmed,
  onResendSignup,
  resendBusy,
  emailSentType,
}: AuthGateProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordReg1, setShowPasswordReg1] = useState(false);
  const [showPasswordReg2, setShowPasswordReg2] = useState(false);
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (stage === "emailSent") {
    return (
      <Card className="rounded-2xl border-0 shadow-md">
        <CardHeader className="space-y-4">
          <CardTitle className="text-xl">
            {emailSentType === "reset"
              ? "パスワード再設定メールを送信しました"
              : "認証メールを送信しました"}
          </CardTitle>
          <CardDescription>
            メールが見つからない場合には、迷惑メールフォルダやプロモーションタブをご確認ください。
          </CardDescription>
        </CardHeader>
        <CardContent></CardContent>
      </Card>
    );
  }

  if (stage === "register") {
    const isValidPassword = passwordRegex.test(password);
    const passwordsMatch = password && password2 && password === password2; // ← 追加

    return (
      <Card className="rounded-2xl border-0 shadow-md">
        <CardHeader>
          <CardTitle className="text-xl">パスワード設定</CardTitle>
          <CardDescription>
            {email} のアカウントを作成します。パスワードを設定してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* パスワード */}
            <div className="space-y-2">
              <Label htmlFor="pw1">パスワード</Label>
              <div className="relative">
                <Input
                  id="pw1"
                  type={showPasswordReg1 ? "text" : "password"}
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
                  onClick={() => setShowPasswordReg1((prev) => !prev)}
                  disabled={busy}
                >
                  {showPasswordReg1 ? (
                    <EyeOff className="h-4 w-4 text-gray-500" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-500" />
                  )}
                </Button>
              </div>
            </div>

            {/* ▼ 追加：バリデーション内容の可視化 */}
            <div
              className="rounded-md bg-gray-50 p-3 text-sm"
              role="status"
              aria-live="polite"
            >
              <ul className="space-y-1">
                <li
                  className={
                    isValidPassword ? "text-green-700" : "text-red-700"
                  }
                >
                  {isValidPassword ? "✓" : "✗"}{" "}
                  パスワードは8文字以上・大小英字と数字を各1文字以上含む
                </li>
              </ul>
            </div>

            {/* パスワード確認 */}
            <div className="space-y-2">
              <Label htmlFor="pw2">パスワード（確認）</Label>
              <div className="relative">
                <Input
                  id="pw2"
                  type={showPasswordReg2 ? "text" : "password"}
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
                  onClick={() => setShowPasswordReg2((prev) => !prev)}
                  disabled={busy}
                >
                  {showPasswordReg2 ? (
                    <EyeOff className="h-4 w-4 text-gray-500" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-500" />
                  )}
                </Button>
              </div>
            </div>

            {/* ▼ 追加：一致チェック */}
            {!passwordsMatch && password2 && (
              <p className="text-sm text-red-600">パスワードが一致しません。</p>
            )}

            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            {/* 未確認メールのときは再送導線を表示 */}
            {(resendBusy ||
              emailNotConfirmed ||
              (typeof error === "string" &&
                (error.includes("確認が完了していません") ||
                  error.includes("メール認証が完了していません")))) && (
              <div className="text-right">
                <button
                  type="button"
                  className="text-sm text-blue-600 hover:underline"
                  onClick={onResendSignup}
                  disabled={busy || !!resendBusy}
                  aria-busy={!!resendBusy}
                >
                  {resendBusy ? (
                    <>
                      <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin align-[-2px]" />
                      メール再送中...
                    </>
                  ) : (
                    "認証メールを再送する"
                  )}
                </button>
              </div>
            )}

            {/* ボタン */}
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={onReset} disabled={busy}>
                戻る
              </Button>
              <Button
                onClick={onRegister}
                disabled={
                  busy ||
                  !password ||
                  !password2 ||
                  !passwordsMatch ||
                  !isValidPassword
                }
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 送信中...
                  </>
                ) : (
                  "次へ"
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (stage === "login") {
    const isValidEmail = emailRegex.test((email || "").trim());
    const isValidPassword = passwordRegex.test(password);

    return (
      <Card className="rounded-2xl border-0 shadow-md">
        <CardHeader>
          <CardTitle className="text-xl">
            パスワードを入力してください
          </CardTitle>
          <CardDescription>{email}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
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
                  aria-invalid={!isValidPassword}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 px-3 flex items-center"
                  aria-label={
                    showPassword ? "パスワードを隠す" : "パスワードを表示"
                  }
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-gray-500" />
                  ) : (
                    <Eye className="h-4 w-4 text-gray-500" />
                  )}
                </button>
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
                onClick={onLogin}
                // ▼ 変更：メール形式とパスワード規則の両方を満たすまで無効化
                disabled={busy || !isValidEmail || !isValidPassword}
              >
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
              {resendBusy ||
              emailNotConfirmed ||
              (typeof error === "string" &&
                (error.includes("確認が完了していません") ||
                  error.includes("メール認証が完了していません"))) ? (
                <button
                  type="button"
                  className="text-sm text-blue-600 hover:underline"
                  onClick={onResendSignup}
                  disabled={busy || !!resendBusy}
                  aria-busy={!!resendBusy}
                >
                  {resendBusy ? (
                    <>
                      <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin align-[-2px]" />
                      メール再送中...
                    </>
                  ) : (
                    "認証メールを再送する"
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  className="text-sm text-blue-600 hover:underline"
                  onClick={onForgot}
                  disabled={busy || !!forgotBusy}
                  aria-busy={!!forgotBusy}
                >
                  {forgotBusy ? (
                    <>
                      <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin align-[-2px]" />
                      メール送信中...
                    </>
                  ) : (
                    "パスワードをお忘れの方"
                  )}
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}

/** ----------------- ResolvedView ----------------- */

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
  trialEndsAt?: string;
  recipLimits?: {
    plan: Plan;
    base_slots: number;
    addon_slots: number;
    used_slots: number;
    remaining_slots: number;
  } | null;
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
  trialEndsAt,
  recipLimits,
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

  useEffect(() => setRecipientList(recipients ?? []), [recipients]);
  useEffect(() => setCurrentItems(purchasedItems ?? []), [purchasedItems]);
  useEffect(() => setCurrentProductName(productName), [productName]);
  useEffect(() => setCurrentUnitAmount(unitAmount), [unitAmount]);
  useEffect(() => setCurrentCurrency(currency), [currency]);
  useEffect(
    () => setCurrentBillingInterval(billingInterval),
    [billingInterval]
  );

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
        pending_removal: entry.pending_removal || recipient.pending_removal,
      });
    }

    const normalizedOwner = email.trim().toLowerCase();
    const rank = (r: RecipientInfo) => {
      if (r.email.toLowerCase() === normalizedOwner) return 0; // 契約者
      const via = (r.created_via ?? "").toLowerCase();
      if (via === "addon") return 2; // 追加購入受信者
      return 1; // 初期受信者
    };

    return Array.from(unique.values()).sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.email.localeCompare(b.email);
    });
  }, [recipientList]);

  const editableRecipients = useMemo(
    () => sortedRecipients.filter((r) => !r.pending_removal),
    [sortedRecipients]
  );

  const isTrialLike = (name?: string) => {
    if (!name) return false;
    const s = name.toLowerCase();
    // 製品名に trial / トライアル / 無料トライアル が含まれるものをトライアル扱い
    return (
      s.includes("trial") ||
      s.includes("トライアル") ||
      s.includes("無料トライアル")
    );
  };

  let items = currentItems;

  // 有料プランが確定している時は “トライアルっぽいアイテム” を除外
  if ((plan === "lite" || plan === "business") && items.length) {
    const filtered = items.filter((i) => !isTrialLike(i.name));
    if (filtered.length) {
      items = filtered;
    }
  }

  const displayItems = items.length
    ? items
    : currentProductName &&
      !(plan === "lite" || plan === "business") &&
      isTrialLike(currentProductName)
    ? [] // 有料時にトライアル名だけが来ても出さない
    : currentProductName
    ? [{ name: currentProductName, quantity: 1, type: "base" as const }]
    : [];

  if (isTrialing) {
    return (
      <Card className="rounded-2xl border-0 shadow-md">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-3">
              <h3 className="border-b border-gray-200 pb-2 text-xl font-semibold text-gray-900">
                現在のプラン
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
              プラン/支払期間の変更
            </h3>
            <div>
              <script
                async
                src="https://js.stripe.com/v3/pricing-table.js"
              ></script>
              <stripe-pricing-table
                pricing-table-id="prctbl_1SKADY5wfsh1mLQsvTAi9isM"
                publishable-key="pk_test_51SEPyP5wfsh1mLQsYLJTHeQWuk8l9iaZgi9NuF81nQZ5b7aQT4THbMxA6Fy5EsKjXN06IaBUoTtGjO3wZirwY0to00PDQybv07"
                customer-email={email}
              ></stripe-pricing-table>
            </div>
          </section>
          <section className="space-y-4">
            <h3 className="border-b border-gray-200 pb-2 text-xl font-semibold text-gray-900">
              ご契約の管理
            </h3>
            <div className="space-y-2 rounded-md bg-gray-50 p-4 text-sm text-gray-700">
              <p>
                {`無料トライアル期間が${formatDateJPLong(
                  trialEndsAt
                )}に終了します。`}
              </p>
            </div>
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
            有効なサブスクリプションが見つかりませんでした
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
              現在のプラン
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
                    <span className="ml-2 text-gray-600">{item.quantity}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-600">
                {currentProductName ||
                  (plan === "lite" ? "Lite プラン" : "Business プラン")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onLogout}>
              ログアウト
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-12">
        <RecipientsInlineEditor
          ownerEmail={email}
          plan={plan}
          sortedRecipients={sortedRecipients}
          recipLimits={recipLimits}
          unitAmount={currentUnitAmount}
          currency={currentCurrency}
          billingInterval={currentBillingInterval}
          onRecipientsChange={setRecipientList}
          onRefetch={onRefetch}
        />

        <section className="space-y-4">
          <h3 className="border-b border-gray-200 pb-2 text-xl font-semibold text-gray-900">
            ご契約の管理
          </h3>
          {/* 「配信先の管理」と同じレイアウト + ボタン反転カラー */}
          <div className="grid gap-2 sm:grid-cols-3">
            {/* クレカ変更/支払履歴 */}
            <div className="w-full">
              <PortalButton
                email={email}
                mode="billing"
                label="クレカ変更/支払履歴"
                openInNewTab
              />
            </div>

            {/* プラン/支払期間の変更 */}
            <div className="w-full flex flex-col gap-1">
              <PortalButton
                email={email}
                mode="change"
                label="プラン/支払期間の変更"
                openInNewTab
              />
              <p className="text-[11px] text-gray-500">
                プラン変更時には契約者以外のメール配信先が削除されます。
              </p>
            </div>

            {/* 解約 */}
            <div className="w-full">
              <PortalButton
                email={email}
                mode="cancel"
                label="解約"
                openInNewTab
              />
            </div>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

type RecipientsInlineEditorProps = {
  ownerEmail: string;
  plan: Plan;
  sortedRecipients: RecipientInfo[];
  recipLimits?: {
    plan: Plan;
    base_slots: number;
    addon_slots: number;
    used_slots: number;
    remaining_slots: number;
  } | null;
  unitAmount?: number;
  currency?: string;
  billingInterval?: "month" | "year";
  onRecipientsChange: (recipients: RecipientInfo[]) => void;
  onRefetch?: (targetEmail?: string) => void | Promise<void>;
};

function RecipientsInlineEditor({
  ownerEmail,
  plan,
  sortedRecipients,
  recipLimits,
  unitAmount,
  currency,
  billingInterval,
  onRecipientsChange,
  onRefetch,
}: RecipientsInlineEditorProps) {
  const { toast } = useToast();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [addonRecipientToDelete, setAddonRecipientToDelete] =
    useState<RecipientInfo | null>(null);
  const normalizedOwner = ownerEmail.trim().toLowerCase();
  const baseSlotCount = plan === "business" ? 4 : 1;

  const ownerRecipient = useMemo(
    () =>
      sortedRecipients.find((r) => r.email.toLowerCase() === normalizedOwner) ??
      null,
    [sortedRecipients, normalizedOwner]
  );

  const freeRecipients = useMemo(
    () =>
      sortedRecipients.filter((r) => {
        const emailLower = r.email.toLowerCase();
        const via = (r.created_via ?? "").toLowerCase();
        // 契約者でも追加購入でもない = 無料枠側のスロットとみなす
        return emailLower !== normalizedOwner && via !== "addon";
      }),
    [sortedRecipients, normalizedOwner]
  );

  const addonRecipients = useMemo(
    () =>
      sortedRecipients.filter((r) => {
        const via = (r.created_via ?? "").toLowerCase();
        return via === "addon";
      }),
    [sortedRecipients]
  );

  const baseSlots = useMemo(() => {
    const slots: { key: string; email: string; type: "owner" | "free" }[] = [];

    slots.push({
      key: ownerRecipient?.email || ownerEmail,
      email: ownerRecipient?.email || ownerEmail,
      type: "owner",
    });

    const nonOwnerSlots = Math.max(0, baseSlotCount - 1);
    for (let i = 0; i < nonOwnerSlots; i++) {
      const recipient = freeRecipients[i];
      slots.push({
        key: recipient?.email || `free-${i}`,
        email: recipient?.email || "",
        type: "free",
      });
    }

    return slots;
  }, [ownerRecipient, ownerEmail, freeRecipients, baseSlotCount]);

  const allBaseFilled = baseSlots.every((slot) => slot.email.trim().length > 0);

  const pricePerAddress =
    plan === "business" ? 3980 : plan === "lite" ? 2980 : undefined;

  const canUseInlineEditor = plan === "business" || plan === "lite";
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const [baseValues, setBaseValues] = useState<string[]>(
    baseSlots.map((slot) => slot.email)
  );
  const [baseDirty, setBaseDirty] = useState<boolean[]>(
    baseSlots.map(() => false)
  );
  const [baseSaving, setBaseSaving] = useState<boolean[]>(
    baseSlots.map(() => false)
  );
  const [baseErrorType, setBaseErrorType] = useState<
    ("invalid" | "duplicate" | null)[]
  >(baseSlots.map(() => null));

  useEffect(() => {
    setBaseValues(baseSlots.map((slot) => slot.email));
    setBaseDirty(baseSlots.map(() => false));
    setBaseSaving(baseSlots.map(() => false));
    setBaseErrorType(baseSlots.map(() => null));
  }, [baseSlots]);

  const normalizedExisting = useMemo(() => {
    const set = new Set<string>();
    sortedRecipients.forEach((r) => r.email && set.add(r.email.toLowerCase()));
    set.add(normalizedOwner);
    return set;
  }, [sortedRecipients, normalizedOwner]);

  // 追加購入済み行の編集用
  const [editingAddonIndex, setEditingAddonIndex] = useState<number | null>(
    null
  );
  const [editingAddonValue, setEditingAddonValue] = useState("");
  const [editingAddonError, setEditingAddonError] = useState<
    "invalid" | "duplicate" | null
  >(null);
  const [editingAddonSaving, setEditingAddonSaving] = useState(false);

  // 新規追加購入行
  type NewAddonRow = {
    id: string;
    value: string;
    error: "invalid" | "duplicate" | null;
    saving: boolean;
  };
  const [newAddonRows, setNewAddonRows] = useState<NewAddonRow[]>([]);

  // モーダル確認用の状態
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingSaveId, setPendingSaveId] = useState<string | null>(null);
  const [modalPriceInfo, setModalPriceInfo] = useState<{
    freeCount: number;
    payable: number;
  } | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const handleBaseChange = (index: number, value: string) => {
    setBaseValues((prev) => prev.map((v, i) => (i === index ? value : v)));
    setBaseDirty((prev) => prev.map((v, i) => (i === index ? true : v)));

    const trimmed = value.trim();
    if (!trimmed) {
      setBaseErrorType((prev) => prev.map((v, i) => (i === index ? null : v)));
      return;
    }

    if (!emailRegex.test(trimmed)) {
      setBaseErrorType((prev) =>
        prev.map((v, i) => (i === index ? "invalid" : v))
      );
      return;
    }

    const lower = trimmed.toLowerCase();
    // index 行以外で同じメールが存在する場合も重複扱い
    const duplicateInOtherBase = baseValues.some(
      (v, i) => i !== index && v.trim().toLowerCase() === lower
    );
    const duplicateExisting =
      normalizedExisting.has(lower) &&
      !sortedRecipients
        .filter((r) => r.email.toLowerCase() === lower)
        .some(
          (r) => r.email.toLowerCase() === baseSlots[index].email.toLowerCase()
        );

    if (duplicateInOtherBase || duplicateExisting) {
      setBaseErrorType((prev) =>
        prev.map((v, i) => (i === index ? "duplicate" : v))
      );
      return;
    }

    setBaseErrorType((prev) => prev.map((v, i) => (i === index ? null : v)));
  };

  const handleBaseSave = async (index: number) => {
    const currentSlot = baseSlots[index];
    const trimmed = baseValues[index].trim();
    if (!trimmed || baseErrorType[index]) return;

    setBaseSaving((prev) => prev.map((v, i) => (i === index ? true : v)));
    try {
      if (currentSlot.type === "free" && !currentSlot.email) {
        // 無料枠への新規追加: /api/recipients/free-add
        const res = await fetch("/api/recipients/free-add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerEmail: ownerEmail,
            emails: [trimmed],
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || "配信先の保存に失敗しました。");
        }
      } else if (currentSlot.type === "free" && currentSlot.email) {
        // 既存無料枠の変更: /api/recipients PATCH
        const res = await fetch("/api/recipients", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerEmail: ownerEmail,
            fromEmail: currentSlot.email,
            toEmail: trimmed,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || "メール変更に失敗しました。");
        }
      } else {
        // owner 行はここには来ない想定（編集不可）
        return;
      }

      // 成功時は最新一覧を再取得して親へ反映
      await onRefetch?.(ownerEmail);
    } catch (err) {
      // 仕様上はモーダル表示だが、ここでは alert で簡易対応し、あとで専用モーダルに差し替え可能
      const msg =
        currentSlot.type === "free" && !currentSlot.email
          ? "追加に失敗しました。"
          : "変更に失敗しました。";
      try {
        window.alert(msg);
      } catch {
        console.error(msg, err);
      }
    } finally {
      setBaseSaving((prev) => prev.map((v, i) => (i === index ? false : v)));
    }
  };

  const handleBaseDelete = async (index: number) => {
    const currentSlot = baseSlots[index];
    if (!currentSlot.email || currentSlot.type !== "free") return;

    setBaseSaving((prev) => prev.map((v, i) => (i === index ? true : v)));
    try {
      const res = await fetch("/api/recipients", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerEmail: ownerEmail,
          emails: [currentSlot.email],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "削除に失敗しました。");
      }
      await onRefetch?.(ownerEmail);
    } catch (err) {
      const msg = "削除に失敗しました。";
      try {
        window.alert(msg);
      } catch {
        console.error(msg, err);
      }
    } finally {
      setBaseSaving((prev) => prev.map((v, i) => (i === index ? false : v)));
    }
  };

  if (!canUseInlineEditor) {
    // 従来どおりの単純なリスト表示（プラン不明・対象外の場合）
    return (
      <section className="space-y-3">
        <h3 className="border-b border-gray-200 pb-2 text-xl font-semibold text-gray-900">
          メール配信先
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
                    <span className="ml-2 text-xs text-red-600">削除予定</span>
                  ) : null}
                </span>
                <div className="flex items-center gap-2">
                  {recipient.email.toLowerCase() === normalizedOwner && (
                    <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                      契約者
                    </span>
                  )}
                  {recipient.email.toLowerCase() !== normalizedOwner &&
                    (recipient.created_via ?? "").toLowerCase() === "addon" && (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
                        追加購入
                      </span>
                    )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-600">
            配信先メールアドレスは登録されていません。
          </p>
        )}
      </section>
    );
  }

  const validateEmailDuplicate = (
    value: string,
    ignore?: { baseIndex?: number; addonIndex?: number; newId?: string }
  ) => {
    const trimmed = value.trim();
    if (!trimmed) return null as "invalid" | "duplicate" | null;
    if (!emailRegex.test(trimmed)) return "invalid" as const;

    const lower = trimmed.toLowerCase();

    // ベース行との重複（自身は除外）
    const duplicateInBase = baseValues.some((v, i) => {
      if (ignore?.baseIndex === i) return false;
      return v.trim().toLowerCase() === lower;
    });

    // 既存 recipient との重複（自身は除外）
    const duplicateExisting =
      normalizedExisting.has(lower) &&
      !sortedRecipients
        .filter((r) => r.email.toLowerCase() === lower)
        .some((r) => r.email.toLowerCase() === normalizedOwner);

    // 追加購入既存行との重複（自身は除外）
    const duplicateInAddon = addonRecipients.some((r, i) => {
      if (ignore?.addonIndex === i) return false;
      return r.email.toLowerCase() === lower;
    });

    // 新規追加行との重複（自身は除外）
    const duplicateInNewAddon = newAddonRows.some((row) => {
      if (ignore?.newId && row.id === ignore.newId) return false;
      return row.value.trim().toLowerCase() === lower;
    });

    if (
      duplicateInBase ||
      duplicateExisting ||
      duplicateInAddon ||
      duplicateInNewAddon
    ) {
      return "duplicate";
    }
    return null;
  };

  const handleAddonEditChange = (index: number, value: string) => {
    setEditingAddonValue(value);
    setEditingAddonError(validateEmailDuplicate(value, { addonIndex: index }));
  };

  const handleAddonEditStart = (index: number) => {
    const target = addonRecipients[index];
    if (!target) return;
    setEditingAddonIndex(index);
    setEditingAddonValue(target.email);
    setEditingAddonError(null);
  };

  const handleAddonEditCancel = () => {
    setEditingAddonIndex(null);
    setEditingAddonValue("");
    setEditingAddonError(null);
    setEditingAddonSaving(false);
  };

  const handleAddonEditSave = async (index: number) => {
    const target = addonRecipients[index];
    if (!target) return;
    const trimmed = editingAddonValue.trim();
    if (!trimmed || editingAddonError) return;

    setEditingAddonSaving(true);
    try {
      const res = await fetch("/api/recipients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerEmail,
          fromEmail: target.email,
          toEmail: trimmed,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "メール変更に失敗しました。");
      }
      await onRefetch?.(ownerEmail);
      handleAddonEditCancel();
    } catch (err) {
      const msg = "変更に失敗しました。";
      try {
        window.alert(msg);
      } catch {
        console.error(msg, err);
      }
    } finally {
      setEditingAddonSaving(false);
    }
  };

  const handleOpenDeleteDialog = (recipient: RecipientInfo) => {
    setAddonRecipientToDelete(recipient);
    setIsDeleteDialogOpen(true);
  };

  const executeAddonDelete = async () => {
    if (!addonRecipientToDelete) return;

    setEditingAddonSaving(true);
    try {
      const res = await fetch("/api/recipients", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerEmail,
          emails: [addonRecipientToDelete.email],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "削除に失敗しました。");
      }
      await onRefetch?.(ownerEmail);
      setIsDeleteDialogOpen(false);
      setAddonRecipientToDelete(null);
    } catch (err) {
      const msg = "削除に失敗しました。";
      try {
        toast({
          title: "Error",
          description: msg,
          variant: "destructive",
        });
      } catch {
        console.error(msg, err);
      }
    } finally {
      setEditingAddonSaving(false);
    }
  };

  const handleNewAddonChange = (id: string, value: string) => {
    setNewAddonRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              value,
              error: validateEmailDuplicate(value, { newId: id }),
            }
          : row
      )
    );
  };

  const handleNewAddonSave = async (id: string) => {
    const row = newAddonRows.find((r) => r.id === id);
    if (!row) return;
    const trimmed = row.value.trim();
    if (!trimmed || row.error) return;

    setNewAddonRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, saving: true } : r))
    );

    try {
      // 現在の残り無料枠を取得
      const limRes = await fetch(
        `/api/me/limits?email=${encodeURIComponent(ownerEmail)}`
      );
      let lim: { remaining_slots?: number } | null = null;
      try {
        lim = await limRes.json();
      } catch {
        lim = null;
      }
      const remaining = Number(lim?.remaining_slots ?? 0);
      const freeCount = remaining > 0 ? 1 : 0;
      const payable = 1 - freeCount;

      // モーダルを表示して確認を待つ
      setPendingSaveId(id);
      setModalPriceInfo({ freeCount, payable });
      setShowConfirmModal(true);

      // saving状態を解除（モーダル確認後に再度設定）
      setNewAddonRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, saving: false } : r))
      );
    } catch (err) {
      const msg = "追加に失敗しました。";
      try {
        window.alert(msg);
      } catch {
        console.error(msg, err);
      }
      setNewAddonRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, saving: false } : r))
      );
    }
  };

  const executeNewAddonSave = async () => {
    if (!pendingSaveId) return;

    const row = newAddonRows.find((r) => r.id === pendingSaveId);
    if (!row) return;
    const trimmed = row.value.trim();
    if (!trimmed || row.error) return;

    const freeCount = modalPriceInfo?.freeCount ?? 0;
    const payable = modalPriceInfo?.payable ?? 0;

    setIsConfirming(true);
    setNewAddonRows((prev) =>
      prev.map((r) => (r.id === pendingSaveId ? { ...r, saving: true } : r))
    );

    try {
      // 1) 無料枠があれば先に free-add
      if (freeCount > 0) {
        const freeRes = await fetch("/api/recipients/free-add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerEmail,
            emails: [trimmed],
          }),
        });
        if (!freeRes.ok) {
          const data = await freeRes.json().catch(() => null);
          throw new Error(data?.error || "無料枠の追加に失敗しました。");
        }
      }

      // 2) 有料分があれば Checkout で購入
      if (payable > 0) {
        const res = await fetch("/api/stripe/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan,
            quantity: 1,
            ownerEmail,
            additionalEmails: [trimmed],
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error || "Checkout の実行に失敗しました。");
        }

        if (data?.url) {
          try {
            window.location.href = String(data.url);
          } catch {
            // noop
          }
        }
      }

      await onRefetch?.(ownerEmail);
      setNewAddonRows((prev) => prev.filter((r) => r.id !== pendingSaveId));
    } catch (err) {
      const msg = "追加に失敗しました。";
      try {
        window.alert(msg);
      } catch {
        console.error(msg, err);
      }
      setNewAddonRows((prev) =>
        prev.map((r) => (r.id === pendingSaveId ? { ...r, saving: false } : r))
      );
    } finally {
      // モーダルを閉じる
      setIsConfirming(false);
      setShowConfirmModal(false);
      setPendingSaveId(null);
      setModalPriceInfo(null);
    }
  };

  return (
    <section className="space-y-3">
      <h3 className="border-b border-gray-200 pb-2 text-xl font-semibold text-gray-900">
        メール配信先
      </h3>
      <div className="space-y-3">
        {baseSlots.map((slot, index) => (
          <div key={slot.key} className="flex flex-col gap-1 text-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="relative w-full sm:w-[70%]">
                <Input
                  type="email"
                  value={baseValues[index] ?? ""}
                  disabled={slot.type === "owner" || baseSaving[index]}
                  onChange={(e) => {
                    if (slot.type === "owner") return;
                    handleBaseChange(index, e.target.value);
                  }}
                  placeholder="メールアドレスを入力"
                  className={`w-full ${slot.type === "owner" ? "pr-20" : ""} ${
                    baseErrorType[index] === "invalid" ||
                    baseErrorType[index] === "duplicate"
                      ? "border-red-500 focus-visible:ring-red-500 placeholder:text-red-400"
                      : ""
                  }`}
                />
                {slot.type === "owner" && (
                  <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                    <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                      契約者
                    </span>
                  </div>
                )}
                {slot.type === "free" && (
                  <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                    <Button
                      type="button"
                      size="xs"
                      className="pointer-events-auto h-6 px-2 text-xs"
                      disabled={
                        baseSaving[index] ||
                        !baseDirty[index] ||
                        !baseValues[index]?.trim() ||
                        !!baseErrorType[index]
                      }
                      onClick={() => handleBaseSave(index)}
                    >
                      保存
                    </Button>
                  </div>
                )}
              </div>
              {slot.type === "owner" && (
                <p className="text-[10px] text-gray-500 whitespace-nowrap">
                  契約者のメールアドレスは変更出来ません
                </p>
              )}
              {slot.type === "free" && slot.email && (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={baseSaving[index]}
                    onClick={() => handleBaseDelete(index)}
                  >
                    削除
                  </Button>
                </div>
              )}
            </div>
            {baseErrorType[index] === "invalid" && (
              <p className="text-[10px] text-red-600">
                メールアドレスの形式が正しくありません
              </p>
            )}
            {baseErrorType[index] === "duplicate" && (
              <p className="text-[10px] text-red-600">
                メールアドレスが重複しています
              </p>
            )}
          </div>
        ))}

        {addonRecipients.map((recipient, index) => {
          const isEditing = editingAddonIndex === index;
          const value = isEditing ? editingAddonValue : recipient.email;
          const error = isEditing ? editingAddonError : null;
          return (
            <div key={recipient.email} className="flex flex-col gap-1 text-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <div className="relative w-full sm:w-[70%]">
                  <Input
                    type="email"
                    value={value}
                    disabled={!isEditing || editingAddonSaving}
                    onChange={(e) =>
                      isEditing && handleAddonEditChange(index, e.target.value)
                    }
                    placeholder="メールアドレスを入力"
                    className={`w-full pr-16 ${
                      error === "invalid" || error === "duplicate"
                        ? "border-red-500 focus-visible:ring-red-500 placeholder:text-red-400"
                        : ""
                    }`}
                  />
                  <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1">
                    {!isEditing && (
                      <span className="inline-flex items-center rounded-full border border-gray-300/60 bg-gray-50/60 px-2 py-0.5 text-[11px] text-gray-600/80">
                        追加分
                      </span>
                    )}
                    {isEditing && (
                      <Button
                        type="button"
                        size="xs"
                        className="pointer-events-auto h-6 px-2 text-xs"
                        disabled={
                          editingAddonSaving ||
                          !editingAddonValue.trim() ||
                          !!editingAddonError
                        }
                        onClick={() => handleAddonEditSave(index)}
                      >
                        保存
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-gray-600">
                  {!isEditing ? (
                    <>
                      <Button
                        type="button"
                        size="xs"
                        disabled={editingAddonSaving}
                        onClick={() => handleAddonEditStart(index)}
                        className="bg-black border-black text-white hover:bg-black/90"
                      >
                        変更
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        disabled={editingAddonSaving}
                        onClick={() => handleOpenDeleteDialog(recipient)}
                        className="bg-black border-black text-white hover:bg-black/90"
                      >
                        削除
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={editingAddonSaving}
                      onClick={handleAddonEditCancel}
                    >
                      変更をキャンセルする
                    </Button>
                  )}
                </div>
              </div>
              {error === "invalid" && (
                <p className="text-[11px] text-red-600">
                  メールアドレスの形式が正しくありません。
                </p>
              )}
              {error === "duplicate" && (
                <p className="text-[11px] text-red-600">
                  メールアドレスが重複しています。
                </p>
              )}
            </div>
          );
        })}

        {/* 追加購入確認モーダル */}
        <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">
                購入の確認
              </DialogTitle>
              <DialogDescription>
                {modalPriceInfo && modalPriceInfo.payable > 0 ? (
                  <>
                    配信先追加 : ¥
                    {pricePerAddress
                      ? pricePerAddress.toLocaleString() +
                        " (月額・税別) / 1アドレス毎"
                      : "契約情報が正しく取得できませんでした。"}
                  </>
                ) : (
                  "このメールアドレスを追加します。"
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowConfirmModal(false);
                  setPendingSaveId(null);
                  setModalPriceInfo(null);
                  // saving状態を解除
                  if (pendingSaveId) {
                    setNewAddonRows((prev) =>
                      prev.map((r) =>
                        r.id === pendingSaveId ? { ...r, saving: false } : r
                      )
                    );
                  }
                }}
              >
                キャンセル
              </Button>
              <Button
                type="button"
                onClick={executeNewAddonSave}
                disabled={isConfirming}
              >
                {isConfirming ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    処理中...
                  </>
                ) : (
                  "確定"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 削除確認モーダル */}
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">
                削除の確認
              </DialogTitle>
              <DialogDescription>
                配信先追加したメールアドレスを削除します。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsDeleteDialogOpen(false)}
              >
                キャンセル
              </Button>
              <Button
                onClick={executeAddonDelete}
                disabled={editingAddonSaving}
              >
                {editingAddonSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    削除中...
                  </>
                ) : (
                  "確定"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {newAddonRows.map((row) => {
          const isEditing = !!row.value.trim();
          return (
            <div key={row.id} className="flex flex-col gap-1 text-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <div className="relative w-full sm:w-[70%]">
                  <Input
                    type="email"
                    value={row.value}
                    disabled={row.saving}
                    onChange={(e) =>
                      handleNewAddonChange(row.id, e.target.value)
                    }
                    placeholder="メールアドレスを入力"
                    className={`w-full pr-16 ${
                      row.error === "invalid" || row.error === "duplicate"
                        ? "border-red-500 focus-visible:ring-red-500 placeholder:text-red-400"
                        : ""
                    }`}
                  />
                  <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1">
                    {!isEditing && (
                      <span className="inline-flex items-center rounded-full border border-gray-300/40 bg-gray-50/40 px-2 py-0.5 text-[11px] text-gray-500/80">
                        追加分
                      </span>
                    )}
                    {isEditing && (
                      <Button
                        type="button"
                        size="xs"
                        className="pointer-events-auto h-6 px-2 text-xs"
                        disabled={
                          row.saving || !row.value.trim() || !!row.error
                        }
                        onClick={() => handleNewAddonSave(row.id)}
                      >
                        保存
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-gray-600">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={row.saving}
                    onClick={() => {
                      setNewAddonRows((prev) =>
                        prev.filter((r) => r.id !== row.id)
                      );
                    }}
                  >
                    追加をキャンセルする
                  </Button>
                </div>
              </div>
              {row.error === "invalid" && (
                <p className="text-[11px] text-red-600">
                  メールアドレスの形式が正しくありません。
                </p>
              )}
              {row.error === "duplicate" && (
                <p className="text-[11px] text-red-600">
                  メールアドレスが重複しています。
                </p>
              )}
            </div>
          );
        })}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 pt-1">
          <div className="flex items-center gap-4">
            <Button
              type="button"
              disabled={!allBaseFilled}
              onClick={() => {
                if (!allBaseFilled) return;
                setNewAddonRows((prev) => [
                  ...prev,
                  {
                    id: `${Date.now()}-${prev.length}`,
                    value: "",
                    error: null,
                    saving: false,
                  },
                ]);
              }}
            >
              +
            </Button>
            {typeof pricePerAddress === "number" && (
              <p className="text-xs text-black">
                配信先追加 : ¥{pricePerAddress.toLocaleString()}(月額・税別) /
                1アドレス毎
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
