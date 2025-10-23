import { NextRequest, NextResponse } from "next/server";

// Base64URL を安全にデコード
function decodeBase64Url(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    return Buffer.from(b64 + pad, "base64").toString("utf8");
  } catch {
    return "";
  }
}

const FALLBACK = "https://so.daily-mna.com/";

/**
 * Wix のクリック計測URL例:
 * https://daily-mna.com/so/tr/<uuid>/c?w=<header>.<payload>.<sig>
 * payload は Base64URL で、JSON に u (最終遷移先URL) が入っています。
 *
 * ここでは w の payload から u を取り出して 302 リダイレクトします。
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const w = url.searchParams.get("w");
  if (!w) return NextResponse.redirect(FALLBACK, 302);

  try {
    const parts = w.split(".");
    if (parts.length < 2) return NextResponse.redirect(FALLBACK, 302);

    const payloadJson = decodeBase64Url(parts[1]); // middle part
    const payload = JSON.parse(payloadJson) as { u?: string };
    const target = payload?.u;

    if (typeof target === "string" && /^https?:\/\//.test(target)) {
      // そのまま最終URLへ
      return NextResponse.redirect(target, 302);
    }
  } catch {
    // 失敗時はフォールバックへ
  }
  return NextResponse.redirect(FALLBACK, 302);
}
