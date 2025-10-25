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
      if (!res.ok) throw new Error("購読情報の取得に失敗しました。");
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
      if (!res.ok) throw new Error("購読情報の取得に失敗しました。");
      const data = (await res.json()) as SubscriptionData;
      setSub(data);

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
        className={`mx-auto ${sub?.is_trialing ? "max-w-5xl" : "max-w-2xl"}`}
      >
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-3xl font-bold text-gray-900">マイページ</h1>
        </div>
        {/* 成功メッセージは useEffect で処理済み */}

        {!sub &&
          (!hydrated ? (
            <div />
          ) : booting ? (
            <Card className="mb-6 rounded-2xl border-0 shadow-md">
              <CardHeader>
                <CardTitle className="text-xl">読み込み中...</CardTitle>
                <CardDescription>購読状況を取得しています。</CardDescription>
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
                <CardTitle className="text-xl">メールアドレスを入力</CardTitle>
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
                      "プランを取得"
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
                  setEmailSentType(null);
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
                    取得に失敗しました。
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
        <CardHeader>
          <CardTitle className="text-xl">
            {emailSentType === "reset"
              ? "パスワード再設定メールを送信しました"
              : "認証メールを送信しました"}
          </CardTitle>
          <CardDescription>
            {email} 宛に
            {emailSentType === "reset"
              ? "パスワード再設定メール"
              : "認証メール"}
            を送信しました。
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
    const isValidPassword = passwordRegex.test(password);
    const passwordsMatch = password && password2 && password === password2; // ← 追加

    return (
      <Card className="rounded-2xl border-0 shadow-md">
        <CardHeader>
          <CardTitle className="text-xl">アカウント登録</CardTitle>
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

            {/* 未確認メールのときは再送導線を表示（登録画面でも保持） */}
            {(resendBusy ||
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
                  "登録する"
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
              プラン変更
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
              サブスクリプションの管理
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
        <section className="space-y-4">
          <h3 className="border-b border-gray-200 pb-2 text-xl font-semibold text-gray-900">
            メール配信先
          </h3>
          {recipLimits && (
            <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
              残り無料枠:{" "}
              {Math.max(0, Number(recipLimits.remaining_slots || 0))}
              <span className="ml-3 text-gray-500">
                （ 追加購入: {Number(recipLimits.addon_slots || 0)}）
              </span>
            </div>
          )}
        </section>

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
                  {recipient.email.toLowerCase() ===
                    email.trim().toLowerCase() && (
                    <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                      契約者
                    </span>
                  )}
                  {recipient.email.toLowerCase() !==
                    email.trim().toLowerCase() &&
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

        <section className="space-y-4">
          <h3 className="border-b border-gray-200 pb-2 text-xl font-semibold text-gray-900">
            配信先の管理
          </h3>
          <p className="text-sm text-gray-600">
            管理者のメールアドレスは変更・削除出来ません。
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <AddRecipientsModal
              email={email}
              plan={plan}
              unitAmount={currentUnitAmount}
              currency={currentCurrency}
              billingInterval={currentBillingInterval}
              existingRecipients={sortedRecipients}
              remainingSlots={recipLimits?.remaining_slots}
              onRefetch={() => onRefetch?.(email)}
            />
            <EditRecipientModal
              ownerEmail={email}
              addonRecipients={editableRecipients.filter(
                (r) => r.email.toLowerCase() !== email.trim().toLowerCase()
              )}
              onSuccess={setRecipientList}
            />
            <DeleteRecipientsModal
              ownerEmail={email}
              addonRecipients={editableRecipients.filter(
                (r) => r.email.toLowerCase() !== email.trim().toLowerCase()
              )}
              onSuccess={setRecipientList}
            />
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="border-b border-gray-200 pb-2 text-xl font-semibold text-gray-900">
            サブスクリプションの管理
          </h3>
          <p className="text-sm text-gray-600">
            プラン変更・解約時には契約者以外のメール配信先が削除されます。
          </p>

          {/* 「配信先の管理」と同じレイアウト + ボタン反転カラー */}
          <div className="grid gap-2 sm:grid-cols-3">
            {/* プラン変更 */}
            <div className="w-full">
              <PortalButton email={email} mode="change" label="プラン変更" />
            </div>

            {/* プラン解約 */}
            <div className="w-full">
              <PortalButton email={email} mode="cancel" label="プラン解約" />
            </div>

            {/* 請求・決済 */}
            <div className="w-full">
              <PortalButton email={email} mode="billing" label="請求・決済" />
            </div>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

/** ----------------- AddRecipientsModal ----------------- */

type AddRecipientsModalProps = {
  email: string;
  plan: Plan;
  unitAmount?: number;
  currency?: string;
  billingInterval?: "month" | "year";
  existingRecipients: RecipientInfo[];
  remainingSlots?: number;
  onRefetch?: () => void | Promise<void>;
};

function AddRecipientsModal({
  email,
  plan,
  unitAmount,
  currency,
  billingInterval,
  existingRecipients,
  remainingSlots,
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
  // 無料/有料の分割用
  const [freeCountPlanned, setFreeCountPlanned] = useState(0);
  const [payableCountPlanned, setPayableCountPlanned] = useState(0);
  const [freeEmailsPlanned, setFreeEmailsPlanned] = useState<string[]>([]);
  const [paidEmailsPlanned, setPaidEmailsPlanned] = useState<string[]>([]);
  const [paidCount, setPaidCount] = useState<number>(0); // 保存完了後の追加購入数
  const [freeCount, setFreeCount] = useState<number>(0); // 無料枠で追加できた件数

  const isFirstTimeAddonPurchase = useMemo(
    () =>
      existingRecipients.filter(
        (r) =>
          r.email.toLowerCase() !== email.toLowerCase() &&
          (r.created_via ?? "").toLowerCase() === "addon"
      ).length === 0,
    [existingRecipients, email]
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
      while (next.length < count) next.push("");
      return next;
    });
  }, [count]);

  const normalizedExisting = useMemo(() => {
    const set = new Set<string>();
    existingRecipients.forEach(
      (r) => r.email && set.add(r.email.toLowerCase())
    );
    set.add(email.toLowerCase());
    return set;
  }, [existingRecipients, email]);

  const normalizedNewEmails = useMemo(
    () => emails.map((v) => v.trim().toLowerCase()).filter(Boolean),
    [emails]
  );

  // メール形式チェック（簡易）
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const hasInvalidFormat = useMemo(() => {
    // 全行入力必須（normalizedNewEmails.length === count）を前提に
    // 入力済みの各メールが形式に一致するかを判定
    return emails
      .map((v) => v.trim())
      .filter(Boolean)
      .some((v) => !emailRegex.test(v));
  }, [emails]);

  // 各行の無効判定（UI表示用）は都度計算するため配列化は不要

  const hasExistingDuplicate = normalizedNewEmails.some((v) =>
    normalizedExisting.has(v)
  );
  const hasInternalDuplicate =
    new Set(normalizedNewEmails).size !== normalizedNewEmails.length;

  const handleCountChange = (value: string) => {
    const digits = value.replace(/[^0-9]/g, "");
    if (digits === "") {
      setCountInput("");
      return;
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
    setCount(Math.max(1, n));
  };

  const updateEmail = (index: number, value: string) => {
    setEmails((prev) => prev.map((cur, idx) => (idx === index ? value : cur)));
  };

  const canSubmit =
    normalizedNewEmails.length === count &&
    !hasExistingDuplicate &&
    !hasInternalDuplicate &&
    !hasInvalidFormat &&
    !saving &&
    !prechecking;

  // 入力欄を増減（count は emails.length に自動追従）
  const addEmailRow = () =>
    setEmails((prev) =>
      prev.length >= MAX_ADDITIONAL_RECIPIENTS ? prev : [...prev, ""]
    );
  const removeEmailRow = () =>
    setEmails((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));

  // emails の行数に合わせて count / countInput を同期
  useEffect(() => {
    const n = emails.length;
    setCount(n);
    setCountInput(String(n));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emails.length]);

  // いまの入力数が無料枠で収まるか（= 料金表示を消す条件）
  const remainingNow =
    typeof remainingSlots === "number"
      ? Math.max(0, Number(remainingSlots || 0))
      : 0;
  const isAllFree = typeof remainingSlots === "number" && count <= remainingNow;

  // 指定行を削除（最低1行は残す）
  const removeEmailAt = (idx: number) =>
    setEmails((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)
    );

  const handleOpenConfirm = async () => {
    if (!canSubmit) return;
    setError(null);
    setCheckoutUrl("");
    setAwaitingCheckoutRedirect(false);

    try {
      setPrechecking(true);
      const payloadAll = emails.map((v) => v.trim()).filter(Boolean);

      // 現在の残り枠を取得
      const limRes = await fetch(
        `/api/me/limits?email=${encodeURIComponent(email)}`
      );
      let lim: { remaining_slots?: number } | null = null;
      try {
        lim = await limRes.json();
      } catch {
        lim = null;
      }
      const remaining = Number(lim?.remaining_slots ?? 0);

      const freeCount = Math.max(0, Math.min(remaining, payloadAll.length));
      const payable = Math.max(0, payloadAll.length - freeCount);

      const freeEmails = payloadAll.slice(0, freeCount);
      const paidEmails = payloadAll.slice(freeCount);
      setFreeCountPlanned(freeCount);
      setPayableCountPlanned(payable);
      setFreeEmailsPlanned(freeEmails);
      setPaidEmailsPlanned(paidEmails);

      if (payable > 0) {
        // 有料分のみ precheck（必要ならCheckout遷移）
        const res = await fetch("/api/stripe/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan,
            quantity: payable,
            ownerEmail: email,
            additionalEmails: paidEmails,
            precheck: true,
          }),
        });
        const data = await res.json();
        if (data?.canFinalizeSilently) {
          setAwaitingCheckoutRedirect(false);
        } else if (data?.url) {
          setCheckoutUrl(String(data.url));
          setAwaitingCheckoutRedirect(true);
        } else {
          throw new Error(data?.error || "事前チェックに失敗しました。");
        }
      } else {
        // 全て無料枠内：Checkoutは不要
        setAwaitingCheckoutRedirect(false);
      }

      setSuspendReset(true);
      setOpen(false);
      setConfirmOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラーが発生しました。");
    } finally {
      setPrechecking(false);
    }
  };

  const performPurchase = async () => {
    setSaving(true);
    setError(null);
    try {
      // 1) 無料枠分を先に確定
      if (freeCountPlanned > 0 && freeEmailsPlanned.length > 0) {
        const freeRes = await fetch("/api/recipients/free-add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerEmail: email,
            emails: freeEmailsPlanned,
          }),
        });
        if (!freeRes.ok) {
          const data = await freeRes.json().catch(() => null);
          throw new Error(data?.error || "無料枠の追加に失敗しました。");
        }
      }

      // 2) 有料分があればCheckout/サイレント更新
      if (payableCountPlanned > 0) {
        const res = await fetch("/api/stripe/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan,
            quantity: payableCountPlanned,
            ownerEmail: email,
            additionalEmails: paidEmailsPlanned,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || "Checkout の実行に失敗しました。");
        }
        const data = await res.json();
        if (data?.updated && data?.portalUrl) {
          const d = data as Record<string, unknown>;
          setUpdatedProductName(String(d.productName ?? "追加受信者"));
          setUpdatedQuantity(Number(d.newQuantity ?? payableCountPlanned));
          setPortalUrl(String(d.portalUrl));
          setPaidCount(payableCountPlanned);
          setFreeCount(freeCountPlanned ?? 0);
          setPostUpdateOpen(true);
          setSuspendReset(false);
          setOpen(false);
        } else {
          throw new Error(
            data?.error || "処理に失敗しました。再読み込みしてお試しください。"
          );
        }
      } else {
        // 全て無料で完了 → 成功モーダルを表示（リロードせずに文言出し分け）
        setPaidCount(0);
        setFreeCount(freeCountPlanned ?? 0);
        setUpdatedProductName("追加受信者");
        setUpdatedQuantity(freeCountPlanned);
        setPortalUrl("");
        setPostUpdateOpen(true);
        setSuspendReset(false);
        setOpen(false);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "不明なエラーが発生しました。"
      );
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  };

  // 入力済みのメール数（空白はカウントしない）
  const validEmailCount = emails.reduce((n, v) => n + (v.trim() ? 1 : 0), 0);
  // 入力を反映した残り無料枠（マイナスにならない）
  const remainingAfterInput = Math.max(
    0,
    Number(remainingSlots ?? 0) - validEmailCount
  );

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button className="w-full">追加</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              配信先を追加
            </DialogTitle>
            <DialogDescription>
              追加する配信先のメールアドレスを入力してください。
              {awaitingCheckoutRedirect && (
                <>
                  <br />
                  ※この操作ではチェックアウト画面に遷移する場合があります。
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="px-4 sm:px-6 mt-2">
            {/* 上部3ブロックをまとめて縦間隔を確保 */}
            <div className="space-y-2">
              {/* ① 現在の残り無料枠（動的） */}
              {typeof remainingSlots === "number" && (
                <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">
                  現在の残り無料枠：{remainingAfterInput}
                </div>
              )}

              {/* ② 注意文（太字＆少し大きめ） */}
              <p className="text-sm">
                ※ 無料枠を超えた配信先追加は追加購入となります
              </p>

              {/* ③ 料金（左右余白は上と同一コンテナなので揃う） */}
              {typeof unitAmount !== "undefined" && !isAllFree && (
                <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
                  料金 (月額・消費税10%込)：
                  {formatCurrency(unitAmount, currency)} / 1メール
                </div>
              )}
            </div>

            {/* 入力フォーム */}
            <div className="space-y-3 mt-4">
              <Label>メールアドレス</Label>
              {emails.map((value, index) => {
                const trimmed = (value || "").trim();
                const showInvalid = !!trimmed && !emailRegex.test(trimmed);
                return (
                  <div key={index}>
                    <div className="flex items-center gap-2">
                      <Input
                        type="email"
                        required
                        value={value}
                        onChange={(e) => updateEmail(index, e.target.value)}
                        placeholder={`example${index + 1}@email.com`}
                        disabled={prechecking || saving}
                        className={`flex-1 ${
                          showInvalid
                            ? "border-red-500 focus-visible:ring-red-500 placeholder:text-red-400"
                            : ""
                        }`}
                        aria-invalid={showInvalid}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeEmailAt(index)}
                        disabled={prechecking || saving || emails.length <= 1}
                        aria-label={`行${index + 1}を削除`}
                        title="この行を削除"
                      >
                        ×
                      </Button>
                    </div>
                    {showInvalid && (
                      <p className="mt-1 text-xs text-red-600">
                        メールアドレスの形式が正しくありません。
                      </p>
                    )}
                  </div>
                );
              })}

              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addEmailRow}
                  disabled={
                    prechecking ||
                    saving ||
                    emails.length >= MAX_ADDITIONAL_RECIPIENTS
                  }
                >
                  + 追加
                </Button>
              </div>

              {(hasExistingDuplicate || hasInternalDuplicate) && (
                <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                  メールアドレスが重複しています。
                </div>
              )}
              {/* 入力全体の形式エラーは行単位の表示に統一するため非表示 */}
              {error && (
                <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                  {error}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button variant="outline" disabled={saving}>
                キャンセル
              </Button>
            </DialogClose>
            <Button onClick={handleOpenConfirm} disabled={!canSubmit}>
              {prechecking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  確認中...
                </>
              ) : saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  反映中...
                </>
              ) : (
                "確認へ進む"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 事前確認ダイアログ */}
      <Dialog
        open={confirmOpen}
        onOpenChange={(v) => {
          setConfirmOpen(v);
          if (!v) setAwaitingCheckoutRedirect(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              追加内容の確認
            </DialogTitle>
            <DialogDescription className="mb-6 leading-relaxed">
              {payableCountPlanned > 0 ? (
                // 追加購入が存在する場合
                <div className="space-y-1">
                  {/* 無料枠で入る分があるときだけ先頭に表示 */}
                  {freeCountPlanned > 0 && (
                    <div>無料枠で追加：{freeCountPlanned}件</div>
                  )}
                  <div>配信先追加購入：{payableCountPlanned}件</div>
                  <div>
                    追加購入金額 (消費税10%込)：
                    {formatCurrency(
                      (unitAmount || 0) * payableCountPlanned,
                      currency
                    )}
                  </div>
                </div>
              ) : (
                // すべて無料枠内のとき
                <div>無料枠で追加：{freeCountPlanned}件</div>
              )}

              {awaitingCheckoutRedirect && (
                <span className="mt-4 block text-sm text-muted-foreground">
                  続行するとチェックアウト画面に遷移します。
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
                setOpen(true);
                setAwaitingCheckoutRedirect(false);
              }}
              disabled={saving}
            >
              戻る
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
                チェックアウトへ
              </Button>
            ) : (
              <Button onClick={performPurchase} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...
                  </>
                ) : (
                  "確定"
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 反映後ダイアログ */}
      <Dialog open={postUpdateOpen} onOpenChange={setPostUpdateOpen}>
        <DialogContent>
          <DialogHeader>
            {/* タイトル：更新 → 追加 */}
            <DialogTitle className="text-lg font-bold">
              追加が完了しました
            </DialogTitle>

            {/* 本文：追加購入の有無で出し分け */}
            <DialogDescription className="mb-6 leading-relaxed">
              {paidCount > 0 ? (
                // 追加購入が存在する場合
                <div className="space-y-1">
                  {/* 無料枠内で追加があるときだけ先頭に表示 */}
                  {freeCount > 0 && <div>無料枠で追加完了：{freeCount}件</div>}
                  <div>配信先の追加購入完了：{paidCount}件</div>
                </div>
              ) : (
                // 追加購入が存在しない場合（従来通り）
                <div>無料枠で追加完了：{freeCount}件</div>
              )}
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
            {paidCount > 0 && portalUrl ? (
              <Button asChild>
                <a href={portalUrl} target="_blank" rel="noopener noreferrer">
                  請求・決済を確認
                </a>
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* チェックアウト用（必要時のみ使用） */}
      <Dialog open={postCheckoutOpen} onOpenChange={setPostCheckoutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              チェックアウトに進みます
            </DialogTitle>
            <DialogDescription>
              外部のチェックアウトに遷移します。必要に応じてブラウザのポップアップ許可をご確認ください。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">閉じる</Button>
            </DialogClose>
            {checkoutUrl ? (
              <Button asChild>
                <a href={checkoutUrl} target="_blank" rel="noopener noreferrer">
                  チェックアウトへ
                </a>
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** ----------------- EditRecipientModal ----------------- */

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
    () => addonRecipients.filter((r) => !r.pending_removal),
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
      setError("変更前/変更後のメールを入力してください。");
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
        throw new Error(data?.error || "メール変更に失敗しました。");
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
      setError(
        err instanceof Error ? err.message : "不明なエラーが発生しました。"
      );
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
          <DialogTitle className="text-xl font-bold">配信先を変更</DialogTitle>
          <DialogDescription>
            変更対象を選択し、新しいメールアドレスを入力してください。
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 sm:px-6">
          {done && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
              変更が完了しました。
            </div>
          )}

          {selectableRecipients.length === 0 ? (
            <p className="text-sm text-gray-600">
              変更可能な受信者がいません。
            </p>
          ) : (
            <>
              <div className="space-y-2 mt-4">
                <Label htmlFor="edit-target">変更するメール</Label>
                <select
                  id="edit-target"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 pr-8 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={selectedEmail}
                  onChange={(e) => setSelectedEmail(e.target.value)}
                >
                  {selectableRecipients.map((r) => (
                    <option key={r.email} value={r.email}>
                      {r.email}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 mt-4">
                <Label htmlFor="edit-next">新しいメール</Label>
                <Input
                  id="edit-next"
                  type="email"
                  value={nextEmail}
                  onChange={(e) => setNextEmail(e.target.value)}
                  required
                />
              </div>
            </>
          )}

          {error && (
            <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="mt-6">
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
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 反映中...
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

/** ----------------- DeleteRecipientsModal ----------------- */

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
  // 完了モーダルに表示するための削除件数
  const [deletedFreeCount, setDeletedFreeCount] = useState(0);
  const [deletedPaidCount, setDeletedPaidCount] = useState(0);
  const [isCancellingSubscription, setIsCancellingSubscription] =
    useState(false);

  const addonOnly = useMemo(
    () =>
      addonRecipients.filter(
        (r) => (r.created_via ?? "").toLowerCase() === "addon"
      ),
    [addonRecipients]
  );
  const isDeletingAllAddonRecipients =
    addonOnly.length > 0 && addonOnly.every((r) => selected.has(r.email));

  useEffect(() => {
    if (!open) {
      if (confirmDeleteOpen || postDeleteOpen) return;
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
    () => hasMarked || addonRecipients.some((r) => r.pending_removal),
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
    // 今回削除する件数（無料/有料）を確定して保持
    const selectedList = addonRecipients.filter((r) => selected.has(r.email));
    const paidToDelete = selectedList.filter(
      (r) => (r.created_via ?? "").toLowerCase() === "addon"
    ).length;
    const freeToDelete = selectedList.length - paidToDelete;

    setDeletedPaidCount(paidToDelete);
    setDeletedFreeCount(freeToDelete);
    // 「すべての追加購入を削除＝サブスク自体キャンセル」フラグを確定
    setIsCancellingSubscription(
      paidToDelete > 0 && isDeletingAllAddonRecipients
    );
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
        throw new Error(data?.error || "削除に失敗しました。");
      }
      const data = await res.json();
      if (Array.isArray(data?.recipients)) {
        onSuccess(data.recipients as RecipientInfo[]);
      }
      if (data && typeof data === "object" && "portalUrl" in data) {
        const p = String((data as Record<string, unknown>).portalUrl || "");
        setPortalUrl(p);
      }
      setHasMarked(true);
      setSelected(new Set());
      toast({ title: "削除を反映しました" });
      setConfirmDeleteOpen(false);
      setOpen(false);
      setPostDeleteOpen(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "不明なエラーが発生しました。"
      );
    } finally {
      setPendingEmail(null);
      setDeleting(false);
    }
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
              配信先を削除
            </DialogTitle>
            <DialogDescription>
              削除する配信先を選択してください。
            </DialogDescription>
          </DialogHeader>

          <div className="px-4 sm:px-6">
            {addonRecipients.length === 0 ? (
              <p className="text-sm text-gray-600">
                削除可能な受信者がいません。
              </p>
            ) : (
              <ul className="space-y-2 mt-2">
                {addonRecipients.map((r) => (
                  <li
                    key={r.email}
                    className={`flex items-center justify-between rounded-lg border bg-white px-3 py-2 text-sm ${
                      selected.has(r.email)
                        ? "border-red-300 bg-red-50"
                        : "border-gray-200"
                    }`}
                  >
                    <div>
                      {r.email}
                      {r.pending_removal ? (
                        <span className="ml-2 text-xs text-red-600">
                          削除予定
                        </span>
                      ) : selected.has(r.email) ? (
                        <span className="ml-2 text-xs text-red-600">
                          削除対象
                        </span>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={
                        Boolean(r.pending_removal) || Boolean(pendingEmail)
                      }
                      onClick={() => toggleSelect(r.email)}
                      aria-label={`${r.email} を選択`}
                    >
                      {selected.has(r.email) ? (
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
              <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          <DialogFooter className="mt-6">
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
                setConfirmDeleteOpen(true);
                setOpen(false);
              }}
              disabled={selected.size === 0 || Boolean(pendingEmail)}
            >
              削除実行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 確認ダイアログ */}
      <Dialog
        open={confirmDeleteOpen}
        onOpenChange={(v) => {
          setConfirmDeleteOpen(v);
          if (!v && !postDeleteOpen) setOpen(true);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">削除の確認</DialogTitle>
            <DialogDescription className="mb-6 leading-relaxed">
              {(() => {
                // 今回選択された受信者の無料/有料の内訳
                const selectedList = addonRecipients.filter((r) =>
                  selected.has(r.email)
                );
                const paid = selectedList.filter(
                  (r) => (r.created_via ?? "").toLowerCase() === "addon"
                ).length;
                const free = selectedList.length - paid;

                // 1) 有料の削除が1件以上ある
                if (paid > 0) {
                  return (
                    <div className="space-y-1">
                      {/* 無料枠で追加分が含まれるときだけ先頭に表示 */}
                      {free > 0 && (
                        <div>
                          無料枠で追加した {free} 件の配信先を削除します。
                        </div>
                      )}

                      {isDeletingAllAddonRecipients ? (
                        <div>
                          追加購入した {paid}{" "}
                          件の配信先を削除します。追加購入のサブスクリプションはキャンセルされます。
                        </div>
                      ) : (
                        <div>
                          追加購入した {paid}{" "}
                          件の配信先を削除します。サブスクリプションの数量も更新されます。
                        </div>
                      )}
                    </div>
                  );
                }

                // 2) 無料枠のみ削除
                return (
                  <div>無料枠で追加した {free} 件の配信先を削除します。</div>
                );
              })()}
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
              戻る
            </Button>
            <Button onClick={handleCommitDelete} disabled={deleting}>
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...
                </>
              ) : (
                "削除する"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 完了ダイアログ */}
      <Dialog open={postDeleteOpen} onOpenChange={setPostDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              削除が完了しました
            </DialogTitle>
            <DialogDescription className="mb-6 leading-relaxed">
              {deletedPaidCount > 0 ? (
                <div className="space-y-1">
                  {/* 無料枠の削除があれば先頭に表示 */}
                  {deletedFreeCount > 0 && (
                    <div>
                      無料枠で追加した {deletedFreeCount}{" "}
                      件の配信先を削除しました。
                    </div>
                  )}

                  {isCancellingSubscription ? (
                    <div>
                      追加購入した {deletedPaidCount}{" "}
                      件の配信先を削除しました。追加購入のサブスクリプションはキャンセルされました。
                    </div>
                  ) : (
                    <div>
                      追加購入した {deletedPaidCount}{" "}
                      件の配信先を削除しました。サブスクリプションの数量も更新されました。
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  無料枠で追加した {deletedFreeCount} 件の配信先を削除しました。
                </div>
              )}
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
            {deletedPaidCount > 0 && portalUrl && (
              <Button asChild>
                <a href={portalUrl} target="_blank" rel="noopener noreferrer">
                  請求・決済を確認
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** ----------------- util & empty view ----------------- */

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

function formatDateJPLong(iso?: string) {
  if (!iso) return "終了予定日未定";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "終了予定日未定";
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(d);
  } catch {
    return "終了予定日未定";
  }
}

function NoSubscription({ onReset }: { onReset?: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-gray-700">有料プランの契約がありません。</p>
      {onReset ? (
        <Button variant="outline" onClick={onReset} className="w-full">
          メールアドレス入力に戻る
        </Button>
      ) : null}
    </div>
  );
}
