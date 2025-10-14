"use client";
import { useEffect, useState } from "react";

export default function TrialStartPage() {
  const [message, setMessage] = useState("処理中です...");
  const [detail, setDetail] = useState<string | null>(null);
  const [isPopup, setIsPopup] = useState(false);

  useEffect(() => {
    // ✅ ページがポップアップで開かれたかを判定
    setIsPopup(!!window.opener);

    const run = async () => {
      try {
        const hash = new URLSearchParams(window.location.hash.slice(1));
        const email = hash.get("e");
        if (!email) {
          setMessage("メールアドレスが見つかりません。");
          return;
        }
        const res = await fetch("/api/trial/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const json = await res.json();
        if (json?.ok && json?.already) {
          if (json?.reason === "current") {
            setMessage("すでに無料トライアルは開始済みです。");
          } else if (json?.reason === "ended") {
            setMessage(
              "無料トライアルが既に終了しています。\n無料トライアルは1回のみです。"
            );
          } else {
            setMessage("すでに無料トライアルは開始済みです。");
          }
          return;
        }
        if (json?.ok) {
          setMessage("無料トライアルを開始しました。");
          setDetail(
            json?.subscriptionId ? `申込みID: ${json.subscriptionId}` : null
          );
          return;
        }
        setMessage("エラーが発生しました。");
        setDetail(typeof json?.error === "string" ? json.error : null);
      } catch (e: unknown) {
        setMessage("エラーが発生しました。");
        if (e instanceof Error) {
          setDetail(e.message);
        } else if (typeof e === "string") {
          setDetail(e);
        } else {
          setDetail(null);
        }
      }
    };
    run();
  }, []);

  const handleClose = () => {
    // ✅ ポップアップのみ自動で閉じる
    if (window.opener) {
      window.close();
    }
  };

  return (
    <main className="mx-auto max-w-lg p-6 text-center">
      <h1 className="text-xl font-bold mb-4">無料トライアル</h1>
      <p style={{ whiteSpace: "pre-line" }}>{message}</p>
      {detail ? <p className="mt-2 text-sm text-gray-600">{detail}</p> : null}
      {message !== "処理中です..." && (
        <div className="mt-8 flex justify-center">
          {isPopup ? (
            <button onClick={handleClose} className="underline text-blue-600">
              ウィンドウを閉じる
            </button>
          ) : (
            <p>このウィンドウを閉じてください。</p>
          )}
        </div>
      )}
    </main>
  );
}
