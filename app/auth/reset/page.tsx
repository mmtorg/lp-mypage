"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

function parseHash(hash: string): Record<string, string> {
  const h = hash.replace(/^#/, "");
  const params = new URLSearchParams(h);
  const out: Record<string, string> = {};
  params.forEach((v, k) => (out[k] = v));
  return out;
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword1, setShowPassword1] = useState(false);
  const [showPassword2, setShowPassword2] = useState(false);
  const [email, setEmail] = useState("");
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const isValidPassword = useMemo(() => {
    return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);
  }, [password]);
  const passwordsMatch = useMemo(
    () => !!password && !!password2 && password === password2,
    [password, password2]
  );

  useEffect(() => {
    // Ensure session from recovery link if user landed here directly
    const supabase = getSupabaseBrowser();
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const trySet = async () => {
      if (code) {
        try {
          await supabase.auth.exchangeCodeForSession(code);
          return;
        } catch {}
      }
      const h = parseHash(window.location.hash || "");
      if (h["access_token"] && h["refresh_token"]) {
        try {
          await supabase.auth.setSession({
            access_token: h["access_token"],
            refresh_token: h["refresh_token"],
          });
        } catch {}
      }
      try {
        const { data } = await supabase.auth.getUser();
        const authedEmail = data.user?.email ?? "";
        setEmail(authedEmail);
      } catch {}
    };
    trySet();
  }, []);

  // 追加: セッション有無と reset_error クエリを確認
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        setHasSession(!!data.session);
      } catch {}
    })();
    try {
      const u = new URL(window.location.href);
      const e = u.searchParams.get("reset_error");
      if (e) setResetError(e);
    } catch {}
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidPassword) {
      setError("パスワードは8文字以上・大小英字と数字を各1文字以上含めてください。");
      return;
    }
    if (!passwordsMatch) {
      setError("パスワードが一致しません。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      router.replace("/mypage?reset=1");
    } catch (err) {
      const { toJapaneseAuthErrorMessage } = await import("@/lib/auth-errors");
      setError(
        toJapaneseAuthErrorMessage(err, "パスワードの更新に失敗しました。")
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="mx-auto max-w-2xl">
        <Card className="rounded-2xl border-0 shadow-md">
          <CardHeader>
            <CardTitle className="text-xl">パスワードを再設定してください</CardTitle>
            <CardDescription>{email}</CardDescription>
          </CardHeader>
          <CardContent>
            {hasSession === false && (
              <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {resetError && resetError.toLowerCase().includes("expired")
                  ? "メールリンクが無効または期限切れです。もう一度メールを再送してください。"
                  : "認証セッションが見つかりません。メールを再送してください。"}
              </div>
            )}
            <form onSubmit={onSubmit} className="space-y-4">
              {/* パスワード */}
              <div className="space-y-2">
                <Label htmlFor="pw1">パスワード</Label>
                <div className="relative">
                  <Input
                    id="pw1"
                    name="password"
                    type={showPassword1 ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                    aria-invalid={!isValidPassword}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute inset-y-0 right-0 flex items-center px-3"
                    onClick={() => setShowPassword1((v) => !v)}
                    disabled={busy}
                    aria-label={showPassword1 ? "パスワードを隠す" : "パスワードを表示"}
                  >
                    {showPassword1 ? (
                      <EyeOff className="h-4 w-4 text-gray-500" />
                    ) : (
                      <Eye className="h-4 w-4 text-gray-500" />
                    )}
                  </Button>
                </div>
              </div>

              <div
                className="rounded-md bg-gray-50 p-3 text-sm"
                role="status"
                aria-live="polite"
              >
                <ul className="space-y-1">
                  <li className={isValidPassword ? "text-green-700" : "text-red-700"}>
                    {isValidPassword ? "✓" : "✗"} パスワードは8文字以上・大小英字と数字を各1文字以上含む
                  </li>
                </ul>
              </div>

              {/* パスワード（確認） */}
              <div className="space-y-2">
                <Label htmlFor="pw2">パスワード（確認）</Label>
                <div className="relative">
                  <Input
                    id="pw2"
                    name="password2"
                    type={showPassword2 ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                    className="pr-10"
                    aria-invalid={!passwordsMatch}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute inset-y-0 right-0 flex items-center px-3"
                    onClick={() => setShowPassword2((v) => !v)}
                    disabled={busy}
                    aria-label={showPassword2 ? "パスワードを隠す" : "パスワードを表示"}
                  >
                    {showPassword2 ? (
                      <EyeOff className="h-4 w-4 text-gray-500" />
                    ) : (
                      <Eye className="h-4 w-4 text-gray-500" />
                    )}
                  </Button>
                </div>
              </div>

              {!passwordsMatch && password2 && (
                <p className="text-sm text-red-600">パスワードが一致しません。</p>
              )}

              {error && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
              )}

              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.replace("/mypage")}
                  disabled={busy}
                >
                  戻る
                </Button>
                <Button type="submit" disabled={busy || !isValidPassword || !passwordsMatch || hasSession !== true}>
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 更新中...
                    </>
                  ) : (
                    "パスワードを更新"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
