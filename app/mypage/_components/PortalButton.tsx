"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Stripeポータルボタンコンポーネント
export type PortalButtonProps = { email?: string };
export function PortalButton({ email }: PortalButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // Stripeポータルへの遷移処理
  const handlePortalRedirect = async () => {
    // 多重クリック防止
    if (isLoading) return;

    setIsLoading(true);

    try {
      // Stripe Billing Portal URLを取得するAPIを呼び出し
      const response = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // 必要に応じてユーザー情報やreturn_urlを送信
        body: JSON.stringify({
          return_url: window.location.href, // 現在のページに戻る
          email, // 非ログインでも email で解決可能
        }),
      });

      if (!response.ok) {
        throw new Error("ポータルURLの取得に失敗しました");
      }

      const data = await response.json();

      if (!data.url) {
        throw new Error("無効なポータルURLです");
      }

      // 同一タブで遷移（元の挙動へ戻す）
      window.location.assign(data.url);
    } catch (error) {
      console.error("Portal redirect error:", error);

      // エラートーストを表示
      toast({
        title: "エラーが発生しました",
        description:
          error instanceof Error
            ? error.message
            : "ポータルへの遷移に失敗しました。しばらく時間をおいて再度お試しください。",
        variant: "destructive",
      });

      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        onClick={handlePortalRedirect}
        disabled={isLoading}
        variant="outline"
        className="w-full h-auto p-3 justify-center text-base font-semibold rounded-lg border-2 border-gray-300 bg-white shadow-sm hover:border-gray-400 hover:shadow-md transition"
        aria-label="請求情報を確認・解約"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading...
          </>
        ) : (
          "管理画面を開く"
        )}
      </Button>
    </div>
  );
}
