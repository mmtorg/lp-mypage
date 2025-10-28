"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type PortalMode = "change" | "cancel" | "billing";

export type PortalButtonProps = {
  /** カスタマーポータルを開く対象のオーナーEmail（未指定でも可） */
  email?: string;
  /** 目的：プラン変更 / キャンセル / 請求情報 */
  mode: PortalMode;
  /** ボタン表示ラベル（未指定なら mode に応じた既定文言） */
  label?: string;
  /** 幅を100%にするか */
  fullWidth?: boolean;
};

/**
 * カスタマーポータル遷移ボタン
 * - mode==="change" のとき、オーナー以外の配信先が存在する場合は削除確認を挟む
 * - 削除完了後はモーダルで告知し、ボタン押下でポータル/プラン変更画面へ遷移
 */
export function PortalButton({
  email,
  mode,
  label,
  fullWidth = true,
}: PortalButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [nonOwnerEmails, setNonOwnerEmails] = useState<string[]>([]);
  const [postNoticeOpen, setPostNoticeOpen] = useState(false);
  const [pendingPortalUrl, setPendingPortalUrl] = useState<string | null>(null);
  const { toast } = useToast();

  // カスタマーポータルへ遷移
  const goPortal = useCallback(
    async (purpose: PortalMode, fallbackUrl?: string | null) => {
      try {
        if (fallbackUrl) {
          window.location.assign(fallbackUrl);
          return;
        }
        const response = await fetch("/api/stripe/portal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            return_url: window.location.href,
            email,
            portal: purpose,
          }),
        });
        if (!response.ok) {
          throw new Error(
            "ポータルURLの生成に失敗しました。しばらくしてからお試しください。"
          );
        }
        const data = await response.json();
        if (!data?.url) {
          throw new Error("有効なポータルURLを取得できませんでした。");
        }
        window.location.assign(String(data.url));
      } catch (error) {
        throw error;
      }
    },
    [email]
  );

  // ボタン押下時の挙動
  const handlePortalRedirect = async () => {
    if (isLoading) return;

    // 請求（billing）はそのままポータルへ
    if (mode === "billing") {
      try {
        setIsLoading(true);
        await goPortal("billing");
      } catch (error) {
        console.error("Portal redirect error:", error);
        toast({
          title: "エラーが発生しました",
          description:
            error instanceof Error
              ? error.message
              : "ポータル遷移に失敗しました。しばらくしてから再度お試しください。",
          variant: "destructive",
        });
        setIsLoading(false);
      }
      return;
    }

    // プラン解約は事前削除せずにポータルへ直行（恒久対応）
    if (mode === "cancel") {
      try {
        setIsLoading(true);
        await goPortal("cancel");
      } catch (error) {
        console.error("Portal redirect error:", error);
        toast({
          title: "エラーが発生しました",
          description:
            error instanceof Error
              ? error.message
              : "ポータル遷移に失敗しました。しばらくしてから再度お試しください。",
          variant: "destructive",
        });
        setIsLoading(false);
      }
      return;
    }

    // mode === "change": オーナー以外の配信先があるか事前チェック
    try {
      setIsLoading(true);
      const owner = (email || "").trim();
      if (!owner) {
        // email 未指定でもポータルへ（サーバ側で解決できる前提）
        await goPortal(mode);
        return;
      }

      const checkRes = await fetch(
        `/api/stripe/subscription-by-email?email=${encodeURIComponent(
          owner
        )}&force=1&_=${Date.now()}`
      );

      if (!checkRes.ok) {
        // 取得失敗時はそのままポータルへ
        await goPortal(mode);
        return;
      }

      const sub = await checkRes.json();
      const recips: Array<{ email?: string; pending_removal?: boolean }> =
        Array.isArray(sub?.recipients) ? sub.recipients : [];

      const ownerL = owner.toLowerCase();
      const others = recips
        .map((r) => String(r?.email || "").trim())
        .filter((v) => v && v.toLowerCase() !== ownerL);

      if (others.length === 0) {
        // 非オーナー配信先がいなければそのままポータルへ
        await goPortal(mode);
        return;
      }

      // 非オーナー配信先がいる → 確認ダイアログを表示
      setNonOwnerEmails(Array.from(new Set(others)));
      setConfirmOpen(true);
      setIsLoading(false);
    } catch (error) {
      console.error("precheck error:", error);
      toast({
        title: "エラーが発生しました",
        description:
          error instanceof Error
            ? error.message
            : "事前チェックに失敗しました。しばらくしてから再度お試しください。",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  // 「OK（非オーナーを削除）」押下時
  const handleConfirmDelete = async () => {
    if (isLoading) return;
    const owner = (email || "").trim();
    if (!owner) return;

    try {
      setIsLoading(true);

      const res = await fetch("/api/recipients", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerEmail: owner, emails: nonOwnerEmails }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "配信先の削除に失敗しました。");
      }

      const data = await res.json();
      const portalUrl: string | undefined = data?.portalUrl
        ? String(data.portalUrl)
        : undefined;

      // 削除完了 → 告知モーダルを表示（自動リダイレクトしない）
      setConfirmOpen(false);
      setPostNoticeOpen(true);
      // ここでは「プラン変更/解約」いずれのケースでも
      // 明示的に次のポータル目的を指定して遷移（POST）する
      // API 仕様上 GET は 405 のため、手動遷移時も goPortal(mode) を使う
      setPendingPortalUrl(null);
      setIsLoading(false);
    } catch (error) {
      console.error("delete/redirect error:", error);
      toast({
        title: "エラーが発生しました",
        description:
          error instanceof Error
            ? error.message
            : "配信先の削除または遷移に失敗しました。しばらくしてから再度お試しください。",
        variant: "destructive",
      });
      setIsLoading(false);
      setConfirmOpen(false);
    }
  };

  const defaultLabel =
    mode === "change"
      ? "プランを変更"
      : mode === "cancel"
      ? "サブスクリプションをキャンセル"
      : "請求情報（支払い方法・請求書）";

  const purposeWord = mode === "cancel" ? "プラン解約" : "プラン変更";

  const aria = label || defaultLabel;

  return (
    <div className="space-y-2">
      <Button
        onClick={handlePortalRedirect}
        disabled={isLoading}
        className={fullWidth ? "w-full" : undefined}
        aria-label={aria}
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading...
          </>
        ) : (
          label || defaultLabel
        )}
      </Button>

      {/* 確認ダイアログ（非オーナー配信先がいる場合のみ） */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] sm:max-w-md p-6 gap-4">
          <DialogHeader className="space-y-1">
            <DialogDescription className="leading-6">
              {purposeWord}のため契約者以外の配信先を削除します。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isLoading}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              onClick={handleConfirmDelete}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  実行中...
                </>
              ) : (
                "OK"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 削除完了 → ボタンでポータルへ進む */}
      <Dialog open={postNoticeOpen} onOpenChange={setPostNoticeOpen}>
        <DialogContent className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] sm:max-w-md p-6 gap-4">
          <DialogHeader className="space-y-1">
            <DialogDescription className="leading-6">
              契約者以外の配信先を削除しました。{purposeWord}に進んでください。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <Button
              type="button"
              onClick={async () => {
                setIsLoading(true);
                try {
                  await goPortal(mode);
                } catch (error) {
                  console.error("manual redirect error:", error);
                  toast({
                    title: "エラーが発生しました",
                    description:
                      error instanceof Error
                        ? error.message
                        : "遷移に失敗しました。",
                    variant: "destructive",
                  });
                } finally {
                  setIsLoading(false);
                }
              }}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  開いています...
                </>
              ) : (
                `${purposeWord}を開く`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
