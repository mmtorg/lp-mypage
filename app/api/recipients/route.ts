import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, getUserIdByEmail } from "@/lib/supabase-admin";

type Plan = "lite" | "business" | null;

interface SaveRecipientsBody {
  ownerEmail: string;
  plan?: Plan;
  recipients: string[];
}

function isEmail(str: string): boolean {
  return /.+@.+\..+/.test(str);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SaveRecipientsBody;
    const ownerEmail = (body.ownerEmail || "").trim();
    const plan = body.plan ?? null;
    const recipients = Array.isArray(body.recipients) ? body.recipients : [];

    if (!ownerEmail || !isEmail(ownerEmail)) {
      return NextResponse.json(
        { error: "ownerEmail が不正です" },
        { status: 400 }
      );
    }

    if (recipients.length === 0) {
      return NextResponse.json(
        { error: "recipients が空です" },
        { status: 400 }
      );
    }
    if (recipients.length > 10) {
      return NextResponse.json(
        { error: "recipients は最大10件までです" },
        { status: 400 }
      );
    }

    // 1) 受け取った recipients をクレンジング
    const cleaned = recipients
      .map((e) => (typeof e === "string" ? e.trim() : ""))
      .filter((e) => e && isEmail(e));

    if (cleaned.length !== recipients.length) {
      return NextResponse.json(
        { error: "メールアドレスの形式が正しくありません" },
        { status: 400 }
      );
    }

    // Resolve user_id from owner email (admin)
    const userId = await getUserIdByEmail(ownerEmail);
    if (!userId) {
      return NextResponse.json(
        { error: "ユーザーが見つかりません" },
        { status: 404 }
      );
    }

    // 2) 所有者のメールも必ず含める（ニュース配信先に含めたい要件）
    const allEmails = Array.from(new Set([ownerEmail, ...cleaned]));
    // 3) upsert でユニーク制約（email）に基づき重複を避ける
    const rows = allEmails.map((email) => ({ user_id: userId, plan, email }));
    const { error } = await supabaseAdmin
      .from("recipient_emails")
      .upsert(rows, { onConflict: "email", ignoreDuplicates: true });
    if (error) {
      console.error("Insert recipients error:", error);
      return NextResponse.json(
        { error: "保存に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, upserted: rows.length });
  } catch (e) {
    console.error("/api/recipients error:", e);
    return NextResponse.json({ error: "サーバーエラー" }, { status: 500 });
  }
}
