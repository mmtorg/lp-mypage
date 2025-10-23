"use client";

import { Suspense, useEffect, useMemo, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

const SESSION_EMAIL_KEY = "mypage:lastEmail:session";

function AuthCallbackComponent() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"loading" | "recovery" | "done" | "error">(
    "loading"
  );
  const [message, setMessage] = useState<string>("Loading...");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const isRecovery = useMemo(() => {
    try {
      return (
        (typeof window !== "undefined" &&
          window.location.hash.includes("type=recovery")) ||
        params.get("type") === "recovery"
      );
    } catch {
      return false;
    }
  }, [params]);

  useEffect(() => {
    const run = async () => {
      const supabase = getSupabaseBrowser();
      try {
        // Try code exchange (email confirmation links with ?code=)
        await supabase.auth.exchangeCodeForSession(window.location.search);
      } catch {}

      // If recovery, do not auto-redirect; show password reset form
      if (isRecovery) {
        setMode("recovery");
        setMessage("");
        return;
      }

      try {
        const { data: userRes } = await supabase.auth.getUser();
        const email = userRes.user?.email ?? "";
        if (email) {
          try {
            sessionStorage.setItem(SESSION_EMAIL_KEY, email);
          } catch {}
        }
        setMode("done");
        setMessage("サインインが完了しました。マイページへ移動します...");
        timeoutRef.current = window.setTimeout(
          () => router.replace("/mypage"),
          600
        );
      } catch (e) {
        setMode("error");
        setMessage(
          "サインインの完了処理に失敗しました。マイページから再度お試しください。"
        );
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecovery]);

  const submitRecovery = async () => {
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!pw1 || pw1 !== pw2) {
      setErr("パスワードが一致しません");
      return;
    }
    if (!passwordRegex.test(pw1)) {
      setErr(
        "パスワードは8文字以上で、大文字、小文字、数字をそれぞれ1つ以上含める必要があります。"
      );
      return;
    }
    setBusy(true);
    setErr(null);
    const supabase = getSupabaseBrowser();
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;
      const { data: userRes } = await supabase.auth.getUser();
      const email = userRes.user?.email ?? "";
      if (email) {
        try {
          sessionStorage.setItem(SESSION_EMAIL_KEY, email);
        } catch {}
      }
      setMode("done");
      setMessage("パスワードを更新しました。マイページへ移動します...");
      timeoutRef.current = window.setTimeout(
        () => router.replace("/mypage"),
        600
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "パスワードの更新に失敗しました");
      setBusy(false);
    }
  };

  if (mode === "recovery") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border bg-white shadow p-6 space-y-4">
          <h1 className="text-lg font-semibold">パスワードを再設定</h1>
          <div className="space-y-2">
            <Label htmlFor="pw1">新しいパスワード</Label>
            <Input
              id="pw1"
              type="password"
              value={pw1}
              onChange={(e) => setPw1(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw2">新しいパスワード（確認）</Label>
            <Input
              id="pw2"
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              disabled={busy}
            />
          </div>
          <p className="text-sm text-gray-500">
            パスワードは8文字以上で、大文字、小文字、数字をそれぞれ1つ以上含める必要があります。
          </p>
          {err && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
              {err}
            </div>
          )}
          <div className="flex justify-end">
            <Button
              onClick={submitRecovery}
              disabled={busy || !pw1 || pw1 !== pw2}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 更新中...
                </>
              ) : (
                "パスワードを更新"
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="rounded-xl border bg-white shadow p-6 text-center text-sm text-gray-700">
        {message}
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="rounded-xl border bg-white shadow p-6 text-center text-sm text-gray-700">
            Loading...
          </div>
        </div>
      }
    >
      <AuthCallbackComponent />
    </Suspense>
  );
}
