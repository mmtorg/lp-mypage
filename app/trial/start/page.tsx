"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";

export default function TrialStartPage() {
  const [status, setStatus] = useState<
    "processing" | "success" | "error" | "already" | "ended"
  >("processing");
  const [detail, setDetail] = useState<string | null>(null);
  const [isPopup, setIsPopup] = useState(false);

  const didRun = useRef(false); // ← 追加（StrictMode対策）

  useEffect(() => {
    if (didRun.current) return; // ← 2回目以降は何もしない
    didRun.current = true;

    setIsPopup(!!window.opener);

    const run = async () => {
      try {
        const url = new URL(window.location.href);
        const email = url.searchParams.get("e");

        if (!email) {
          setStatus("error");
          setDetail("メールアドレスが見つかりません。");
          return;
        }

        history.replaceState(null, "", `${url.origin}${url.pathname}`);

        const res = await fetch("/api/trial/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });

        const json = await res.json();

        if (json?.ok && json?.already) {
          if (json?.reason === "current") setStatus("already");
          else if (json?.reason === "ended") setStatus("ended");
          else setStatus("already");
          return;
        }

        if (json?.ok) {
          setStatus("success");
          return;
        }

        setStatus("error");
        setDetail(typeof json?.error === "string" ? json.error : null);
      } catch (e: unknown) {
        setStatus("error");
        if (e instanceof Error) {
          setDetail(e.message);
        } else {
          setDetail(String(e));
        }
      }
    };

    run();
  }, []);

  const handleClose = () => {
    if (window.opener) window.close();
  };

  // ---- 成功時の表示 ----
  if (status === "success") {
    return (
      <main className="mx-auto max-w-2xl p-10 text-center text-[1.1rem] leading-[2rem] space-y-8">
        <h1 className="text-2xl font-bold mb-12">登録が完了しました！</h1>

        <p>
          無料トライアルの30日間、毎朝ニュースをお届けします。
          <br />
          メール配信は日本時間6:30頃、ミャンマー時間4:00頃です。
        </p>

        <section className="bg-gray-50 border border-gray-200 rounded-xl p-8 shadow-sm space-y-8">
          <div>
            <h2 className="text-lg font-semibold mb-3 text-center">
              有料プランへの移行方法
            </h2>
            <p className="text-gray-700 text-[1rem] leading-[1.9rem] text-center">
              毎朝お届けする配信メール内に申込ボタンがございます。
              <br />
              <Link
                href="https://www.daily-mna.com/pricing-m"
                target="_blank"
                className="text-blue-600 underline font-medium"
              >
                こちら
              </Link>
              からも、お申込頂けます。
            </p>
          </div>

          <div>
            <h3 className="text-md font-semibold mb-3 text-center">
              サービス開始記念 特別ご優待
            </h3>
            <p className="text-gray-700 text-[1rem] leading-[1.9rem] text-center mb-6">
              無料トライアル期間中の有料プラン申込で、
              <br />
              もれなくAmazonギフト券を進呈致します。
            </p>

            <div className="bg-white border-t-4 border-b-4 border-black rounded-sm overflow-hidden shadow-sm">
              <table className="w-full text-center text-[1rem] leading-[2rem] border-collapse">
                <thead>
                  <tr className="font-bold">
                    <th className="py-3 w-1/3"></th>
                    <th className="py-3">Lite</th>
                    <th className="py-3">Business</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-3 text-left pl-4 align-top">
                      <span className="block text-sm text-gray-600">
                        トライアル開始後
                      </span>
                      15日以内のお申込
                    </td>
                    <td className="py-3 font-medium">3,000円分</td>
                    <td className="py-3 font-medium">6,000円分</td>
                  </tr>
                  <tr>
                    <td className="py-3 text-left pl-4">16〜30日の申込</td>
                    <td className="py-3 font-medium">2,000円分</td>
                    <td className="py-3 font-medium">5,000円分</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="text-[1rem] text-gray-600 mt-3 text-center">
              ※ 無料トライアルと
              <span className="font-semibold underline underline-offset-2">
                同一メールアドレス
              </span>
              でのお申込に限ります。
            </p>
          </div>
        </section>

        {isPopup && (
          <div className="mt-8 flex justify-center">
            <button
              onClick={handleClose}
              className="underline text-blue-600 text-sm"
            >
              ウィンドウを閉じる
            </button>
          </div>
        )}
      </main>
    );
  }

  // ---- すでに無料トライアル中（スクショ準拠表示）----
  if (status === "already") {
    return (
      <main className="mx-auto max-w-2xl p-10 text-center text-[1.1rem] leading-[2rem] space-y-8">
        <h1 className="text-2xl font-bold mb-12">
          すでに無料トライアルが開始しています
        </h1>

        <div className="space-y-6 text-gray-800">
          <p>ご登録のメールアドレスは、現在無料トライアル期間中です。</p>
          <p>
            毎朝の配信メールが届いていない場合には、
            <br />
            迷惑メールフォルダなどをご確認ください。
          </p>
          <p>
            それでも、見当たらない場合には{" "}
            <Link
              href="https://www.daily-mna.com/contact" // ←実際の問い合わせURLに変更可
              target="_blank"
              className="text-blue-600 underline font-medium"
            >
              こちら
            </Link>
            からご連絡ください。
          </p>
        </div>

        {isPopup && (
          <div className="mt-8 flex justify-center">
            <button
              onClick={handleClose}
              className="underline text-blue-600 text-sm"
            >
              ウィンドウを閉じる
            </button>
          </div>
        )}
      </main>
    );
  }

  // ---- 無料トライアル終了時（スクショ準拠表示）----
  if (status === "ended") {
    return (
      <main className="mx-auto max-w-2xl p-10 text-center text-[1.1rem] leading-[2rem] space-y-8">
        <h1 className="text-2xl font-bold mb-12">
          すでに無料トライアルが終了しています
        </h1>

        <div className="space-y-2 text-gray-800">
          <p>無料トライアルは1回のみです。</p>
          <p>
            有料プランのお申込は{" "}
            <Link
              href="https://www.daily-mna.com/pricing-m" // ←実際の料金ページに変更OK
              target="_blank"
              className="text-blue-600 underline font-medium"
            >
              こちら
            </Link>
            からお願い致します。
          </p>
        </div>

        {isPopup && (
          <div className="mt-8 flex justify-center">
            <button
              onClick={handleClose}
              className="underline text-blue-600 text-sm"
            >
              ウィンドウを閉じる
            </button>
          </div>
        )}
      </main>
    );
  }

  // ---- エラーまたはその他 ----
  return (
    <main className="mx-auto max-w-lg p-6 text-center">
      <h1 className="text-xl font-bold mb-4">無料トライアル</h1>
      {status === "processing" && <p>処理中です...</p>}
      {status === "error" && (
        <p>エラーが発生しました。{detail && <span>{detail}</span>}</p>
      )}

      {status !== "processing" && (
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
