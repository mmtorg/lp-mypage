import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMailViaWebhook } from "@/lib/mailer";

export const runtime = "nodejs"; // 署名検証や外部HTTPのため Node 実行

function isEmail(str: string): boolean {
  return /.+@.+\..+/.test(str);
}

function appOrigin(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_ORIGIN || req.nextUrl.origin;
}

function csv(name: string): Set<string> {
  const v = process.env[name];
  if (!v) return new Set();
  return new Set(
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function allowOrigin(): string {
  return process.env.TRIAL_CORS_ALLOW_ORIGIN || "*";
}

function withCORS(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", allowOrigin());
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  return res;
}

export async function OPTIONS() {
  // CORS preflight
  return withCORS(new NextResponse(null, { status: 204 }));
}

function resolveProductId(input: { productId?: string; plan?: string }): string | null {
  const direct = (input.productId || "").trim();
  if (direct) return direct;
  const plan = String(input.plan || "").toLowerCase();
  if (!plan) return null;
  const list = plan === "lite" ? process.env.STRIPE_PRODUCT_IDS_LITE : plan === "business" ? process.env.STRIPE_PRODUCT_IDS_BUSINESS : "";
  const first = (list || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return first || null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      productId?: string;
      plan?: string; // Wix 既存実装互換: plan -> productId マッピング
    };

    const email = String(body?.email || "").trim();
    const productId = resolveProductId({ productId: body?.productId, plan: body?.plan }) || "";
    if (!isEmail(email)) {
      return withCORS(NextResponse.json({ error: "invalid email" }, { status: 400 } as any));
    }
    if (!productId) {
      return withCORS(NextResponse.json({ error: "productId is required" }, { status: 400 } as any));
    }

    // 許可されたトライアル商品かをチェック（環境変数 STRIPE_TRIAL_PRODUCT_IDS）
    const TRIAL_PRODUCTS = csv("STRIPE_TRIAL_PRODUCT_IDS");
    if (TRIAL_PRODUCTS.size > 0 && !TRIAL_PRODUCTS.has(productId)) {
      return withCORS(NextResponse.json({ error: "product not allowed for trial" }, { status: 400 } as any));
    }

    // トークン生成（URL安全なランダム）
    const token = crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    // 保存（重複トークンはunique制約で防止）
    const { error: insErr } = await supabaseAdmin.from("trial_requests").insert({
      email,
      product_id: productId,
      token,
      status: "requested",
      expires_at: expiresAt.toISOString(),
    });
    if (insErr) {
      console.error("[trial:request] insert error", insErr);
      return withCORS(NextResponse.json({ error: "failed to persist request" }, { status: 500 } as any));
    }

    const origin = appOrigin(req);
    const activationUrl = new URL(`/api/trial/activate?token=${encodeURIComponent(token)}`, origin).toString();

    // 送信モード: Wix側でメール送信する場合はリンクを返す
    const wixSends = process.env.TRIAL_WIX_SENDS_MAIL === "1";
    if (wixSends || process.env.TRIAL_DEBUG_RETURN_LINK === "1") {
      return withCORS(NextResponse.json({ ok: true, activation_url: activationUrl } as any));
    }

    // サーバー側送信（Webhook 経由）
    const FROM = process.env.EMAIL_FROM || undefined; // メールアドレスA
    const subject = "無料トライアルのご案内";
    const text = `以下のURLから無料トライアルを開始してください:\n${activationUrl}\nこのリンクは24時間有効です。`;
    const html = `無料トライアルを開始するには、次のボタンをクリックしてください。<br/><a href="${activationUrl}">無料トライアルを開始する</a><br/>※ このリンクは24時間有効です。`;

    const mailRes = await sendMailViaWebhook({ to: email, from: FROM, subject, text, html });
    if (!mailRes.ok) {
      console.warn("[trial:request] send mail failed; returning link for backup");
      return withCORS(NextResponse.json({ ok: true, activation_url: activationUrl, warn: "mail_failed" } as any));
    }

    return withCORS(NextResponse.json({ ok: true } as any));
  } catch (e) {
    console.error("/api/trial/request error", e);
    return withCORS(NextResponse.json({ error: "server error" }, { status: 500 } as any));
  }
}
