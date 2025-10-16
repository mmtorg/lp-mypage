/**
 * シンプルなメール送信アブストラクション。
 * 既存のインフラに合わせて、HTTP Webhook にPOSTする方式と
 * Wix側でメール送信する場合にリンクを返す方式（呼び出し側で制御）に対応。
 */

export type MailPayload = {
  to: string;
  from?: string; // 例: メールアドレスA
  subject: string;
  text?: string;
  html?: string;
};

export type MailResult = {
  ok: boolean;
  provider?: string;
  requestId?: string;
};

/**
 * MAIL_WEBHOOK_URL が設定されていれば、そこに {to, from, subject, text, html} をJSONでPOSTします。
 * 例: Gmail APIを叩く独自エンドポイント / Supabase Edge Function / Apps Script など。
 */
export async function sendMailViaWebhook(payload: MailPayload): Promise<MailResult> {
  const url = process.env.MAIL_WEBHOOK_URL;
  if (!url) return { ok: false };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.MAIL_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.MAIL_WEBHOOK_TOKEN}` } : {}) },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("sendMailViaWebhook: failed", res.status, text);
      return { ok: false };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, provider: data?.provider || "webhook", requestId: data?.id };
  } catch (e) {
    console.warn("sendMailViaWebhook error", e);
    return { ok: false };
  }
}

