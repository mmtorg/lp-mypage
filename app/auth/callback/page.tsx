"use client";
export const dynamic = "force-static"; // 静的エクスポートを強制

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

function parseHash(hash: string): Record<string, string> {
  const h = hash.replace(/^#/, "");
  const params = new URLSearchParams(h);
  const out: Record<string, string> = {};
  params.forEach((v, k) => (out[k] = v));
  return out;
}

function AuthCallbackInner() {
  const router = useRouter();
  const search = useSearchParams();

  useEffect(() => {
    const run = async () => {
      const supabase = getSupabaseBrowser();

      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const token_hash = url.searchParams.get("token_hash");
      const type = url.searchParams.get("type") || undefined;
      const qError = url.searchParams.get("error");
      const qErrorCode = url.searchParams.get("error_code");
      const qErrorDesc = url.searchParams.get("error_description");

      let encounteredError: string | null = null;

      // 1) token_hash 優先: メールリンクの検証でセッション確立
      if (token_hash && type) {
        try {
          const allowedTypes = [
            "recovery",
            "signup",
            "invite",
            "magiclink",
            "email",
          ] as const;
          type OtpType = (typeof allowedTypes)[number];
          const otpType = allowedTypes.includes(type as OtpType)
            ? (type as OtpType)
            : undefined;

          if (otpType) {
            const { error } = await supabase.auth.verifyOtp({
              type: otpType,
              token_hash,
            });
            if (error) throw error;
          }
        } catch (e) {
          const err = e as unknown;
          let msg: string | undefined;
          if (err instanceof Error) msg = err.message;
          else if (
            typeof err === "object" &&
            err !== null &&
            "message" in err &&
            typeof (err as { message: unknown }).message === "string"
          )
            msg = (err as { message: string }).message;
          else if (typeof err === "string") msg = err;
          if (msg) encounteredError = msg;
        }
      }

      // 2) まだセッションが無ければ PKCE コード交換を試す
      if (code) {
        try {
          const { data } = await supabase.auth.getSession();
          const has = !!data.session;
          if (!has) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) throw error;
          }
        } catch (e) {
          const msg = (e as Error)?.message;
          if (msg) encounteredError = msg;
        }
      }

      // 3) 最後のフォールバック: ハッシュ内トークンを直接セット
      const hashParams = parseHash(window.location.hash || "");
      const access_token = hashParams["access_token"];
      const refresh_token = hashParams["refresh_token"];
      const hashType = hashParams["type"];

      if (access_token && refresh_token) {
        try {
          await supabase.auth.setSession({ access_token, refresh_token });
        } catch {}
      }

      // Determine session availability finally
      let hasSession = false;
      try {
        const { data } = await supabase.auth.getSession();
        hasSession = !!data.session;
      } catch {}

      const flow = search.get("flow") || type || hashType || "";

      // Redirect based on flow
      if (flow === "recovery") {
        if (hasSession) {
          router.replace("/auth/reset");
        } else {
          const err =
            qErrorCode ||
            qError ||
            encounteredError ||
            qErrorDesc ||
            "auth_session_missing";
          router.replace(`/mypage?reset_error=${encodeURIComponent(err)}`);
        }
        return;
      }

      if (hasSession) {
        router.replace("/mypage?welcome=1");
      } else {
        const err =
          qErrorCode ||
          qError ||
          encounteredError ||
          qErrorDesc ||
          "auth_session_missing";
        router.replace(`/mypage?auth_error=${encodeURIComponent(err)}`);
      }
    };

    run();
  }, [router, search]);

  return null;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallbackInner />
    </Suspense>
  );
}
