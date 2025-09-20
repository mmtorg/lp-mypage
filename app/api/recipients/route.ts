import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { stripe } from "@/lib/stripe";

type Plan = "lite" | "business" | null;

interface SaveRecipientsBody {
  ownerEmail: string;
  plan?: Plan;
  recipients: string[];
}

interface UpdateRecipientBody {
  ownerEmail: string;
  fromEmail: string;
  toEmail: string;
}

interface DeleteRecipientsBody {
  ownerEmail: string;
  emails?: string[];
  email?: string;
}

const MAX_RECIPIENTS = 10;

type RecipientRow = {
  id: number;
  email: string | null;
  created_via: string | null;
  user_stripe_id: number | null;
  pending_removal: boolean | null;
};

type UserStripeRow = {
  id: number;
  email: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_plan: Plan;
  updated_at: string;
};

type RecipientPayload = {
  email: string;
  created_via: "initial" | "addon" | null;
  is_owner: boolean;
  pending_removal: boolean;
};

interface OwnerContext {
  ownerEmail: string;
  normalizedOwner: string;
  plan: Plan;
  userStripeRows: UserStripeRow[]; // 該当メールの全サブスクリプション
}

function isEmail(str: string): boolean {
  return /.+@.+\..+/.test(str);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function resolveOwnerContext(ownerEmailRaw: string): Promise<OwnerContext> {
  const ownerEmail = ownerEmailRaw.trim();
  const normalizedOwner = normalizeEmail(ownerEmail);
  let plan: Plan = null;
  let userStripeRows: UserStripeRow[] = [];

  try {
    const { data, error } = await supabaseAdmin
      .from("user_stripe")
      .select("id, email, stripe_customer_id, stripe_subscription_id, current_plan, updated_at")
      .eq("email", ownerEmail);
    if (error) throw error;
    userStripeRows = (data ?? []) as UserStripeRow[];
    // 代表プラン（何れかが設定されていれば優先）
    plan = (userStripeRows.find((r) => r.current_plan)?.current_plan as Plan) ?? null;
  } catch (err) {
    console.warn("resolveOwnerContext: failed to fetch user_stripe", err);
  }

  return { ownerEmail, normalizedOwner, plan, userStripeRows };
}

async function fetchRecipientRows(ctx: OwnerContext): Promise<RecipientRow[]> {
  if (!ctx.userStripeRows.length) return [];
  const ids = ctx.userStripeRows.map((r) => r.id);
  const { data, error } = await supabaseAdmin
    .from("recipient_emails")
    .select("id, email, created_via, pending_removal, user_stripe_id")
    .in("user_stripe_id", ids);
  if (error) throw error;
  return (data ?? []) as RecipientRow[];
}

function toRecipientPayload(rows: RecipientRow[], normalizedOwner: string): RecipientPayload[] {
  return rows
    .filter((row): row is RecipientRow & { email: string } => typeof row.email === "string" && row.email.length > 0)
    .map((row) => ({
      email: row.email,
      created_via:
        row.created_via === "addon"
          ? "addon"
          : row.created_via === "initial"
          ? "initial"
          : null,
      is_owner: row.email.toLowerCase() === normalizedOwner,
      pending_removal: Boolean(row.pending_removal),
    }));
}

function countActiveAddonRecipients(rows: RecipientRow[]): number {
  return rows.filter((row) => (row.created_via ?? "").toLowerCase() === "addon" && !row.pending_removal).length;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SaveRecipientsBody;
    const ownerEmail = (body.ownerEmail || "").trim();
    const plan = body.plan ?? null;
    const recipients = Array.isArray(body.recipients) ? body.recipients : [];

    if (!ownerEmail || !isEmail(ownerEmail)) {
      return NextResponse.json(
        { error: "所有者のメールアドレスが不正です" },
        { status: 400 }
      );
    }

    if (recipients.length === 0) {
      return NextResponse.json(
        { error: "追加するメールアドレスを入力してください" },
        { status: 400 }
      );
    }

    if (recipients.length > MAX_RECIPIENTS) {
      return NextResponse.json(
        { error: `追加できるメールアドレスは最大${MAX_RECIPIENTS}件です` },
        { status: 400 }
      );
    }

    const cleaned = recipients
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value && isEmail(value));

    if (cleaned.length !== recipients.length) {
      return NextResponse.json(
        { error: "メールアドレスの形式が正しくありません" },
        { status: 400 }
      );
    }

    const ctx = await resolveOwnerContext(ownerEmail);
    const effectivePlan: Plan = plan ?? ctx.plan ?? null;
    if (!ctx.userStripeRows.length) {
      return NextResponse.json({ error: "契約情報が見つかりませんでした" }, { status: 404 });
    }

    // 紐付け対象 user_stripe は、updated_at が最新の行を代表として使用
    const parent = [...ctx.userStripeRows]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
    // 追加登録分のみ保存（所有者メールは除外）
    const addonEmails = Array.from(new Set(cleaned));
    const rows = addonEmails.map((email) => ({
      plan: effectivePlan,
      email,
      user_stripe_id: parent.id,
      pending_removal: false,
    }));

    const { error } = await supabaseAdmin
      .from("recipient_emails")
      .upsert(rows, { onConflict: "email", ignoreDuplicates: true });

    if (error) {
      console.error("Insert recipients error:", error);
      return NextResponse.json(
        { error: "配信先の保存に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, upserted: rows.length });
  } catch (err) {
    console.error("/api/recipients POST error:", err);
    return NextResponse.json({ error: "サーバーエラー" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<
      UpdateRecipientBody & {
        owner_email?: string;
        from_email?: string;
        to_email?: string;
      }
    >;

    const ownerEmail = (body.ownerEmail ?? body.owner_email ?? "").trim();
    const fromEmail = (body.fromEmail ?? body.from_email ?? "").trim();
    const toEmail = (body.toEmail ?? body.to_email ?? "").trim();

    if (!isEmail(ownerEmail) || !isEmail(fromEmail) || !isEmail(toEmail)) {
      return NextResponse.json(
        { error: "メールアドレスの形式が正しくありません" },
        { status: 400 }
      );
    }

    const ctx = await resolveOwnerContext(ownerEmail);
    if (!ctx.userStripeRows.length) {
      return NextResponse.json(
        { error: "契約情報が見つかりませんでした" },
        { status: 404 }
      );
    }

    const rows = await fetchRecipientRows(ctx);
    if (!rows.length) {
      return NextResponse.json(
        { error: "登録済みのメールアドレスが見つかりませんでした" },
        { status: 404 }
      );
    }

    const normalizedFrom = normalizeEmail(fromEmail);
    const normalizedTo = normalizeEmail(toEmail);

    if (normalizedFrom === normalizedTo) {
      return NextResponse.json(
        { error: "同じメールアドレスには変更できません" },
        { status: 400 }
      );
    }

    if (normalizedTo === ctx.normalizedOwner) {
      return NextResponse.json(
        { error: "契約者のメールアドレスには変更できません" },
        { status: 400 }
      );
    }

    const target = rows.find((row) => (row.email ?? "").toLowerCase() === normalizedFrom);
    if (!target || typeof target.email !== "string") {
      return NextResponse.json(
        { error: "対象のメールアドレスが見つかりません" },
        { status: 404 }
      );
    }

    if (target.email.toLowerCase() === ctx.normalizedOwner) {
      return NextResponse.json(
        { error: "契約者のメールアドレスは変更できません" },
        { status: 400 }
      );
    }

    if ((target.created_via ?? "").toLowerCase() !== "addon") {
      return NextResponse.json(
        { error: "追加登録されたメールアドレスのみ変更できます" },
        { status: 400 }
      );
    }

    if (rows.some((row) => row.id !== target.id && (row.email ?? "").toLowerCase() === normalizedTo)) {
      return NextResponse.json(
        { error: "既に同じメールアドレスが登録されています" },
        { status: 409 }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("recipient_emails")
      .update({ email: normalizedTo, pending_removal: false })
      .eq("id", target.id);

    if (updateError) {
      console.error("Recipient update error:", updateError);
      return NextResponse.json(
        { error: "メールアドレスの更新に失敗しました" },
        { status: 500 }
      );
    }

    const updatedRows = await fetchRecipientRows(ctx);
    const recipients = toRecipientPayload(updatedRows, ctx.normalizedOwner);

    return NextResponse.json({
      ok: true,
      updated: { from: target.email, to: normalizedTo },
      remaining_addon_count: countActiveAddonRecipients(updatedRows),
      recipients,
    });
  } catch (err) {
    console.error("/api/recipients PATCH error:", err);
    return NextResponse.json({ error: "サーバーエラー" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as DeleteRecipientsBody & { owner_email?: string };
    const ownerEmail = (body.ownerEmail ?? body.owner_email ?? "").trim();

    let targets: string[] = [];
    if (Array.isArray(body.emails)) {
      targets = body.emails;
    } else if (typeof body.email === "string") {
      targets = [body.email];
    }
    targets = targets
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean);

    if (!isEmail(ownerEmail) || targets.some((candidate) => !isEmail(candidate))) {
      return NextResponse.json(
        { error: "メールアドレスの形式が正しくありません" },
        { status: 400 }
      );
    }

    const ctx = await resolveOwnerContext(ownerEmail);
    if (!ctx.userStripeRows.length) {
      return NextResponse.json(
        { error: "契約情報が見つかりませんでした" },
        { status: 404 }
      );
    }

    const rows = await fetchRecipientRows(ctx);
    if (!rows.length) {
      return NextResponse.json(
        { error: "削除対象のメールアドレスが見つかりませんでした" },
        { status: 404 }
      );
    }

    const normalizedTargets = Array.from(new Set(targets.map(normalizeEmail)));
    const markIds: number[] = [];
    const skipped: string[] = [];

    for (const targetEmail of normalizedTargets) {
      const row = rows.find((item) => (item.email ?? "").toLowerCase() === targetEmail);
      if (!row || typeof row.email !== "string") {
        skipped.push(targetEmail);
        continue;
      }
      if (row.email.toLowerCase() === ctx.normalizedOwner) {
        skipped.push(row.email);
        continue;
      }
      if ((row.created_via ?? "").toLowerCase() !== "addon") {
        skipped.push(row.email);
        continue;
      }
      markIds.push(row.id);
    }

    if (!markIds.length) {
      return NextResponse.json(
        { error: "削除可能なメールアドレスが選択されていません", skipped },
        { status: 400 }
      );
    }

    // First adjust Stripe (decrement quantity / cancel when needed). Only on success we alter DB
    const stripeOk = await adjustStripeForDeletion(rows, markIds, ctx.userStripeRows);
    if (!stripeOk) {
      return NextResponse.json(
        { error: "Stripe側の数量変更に失敗しました。時間を置いて再度お試しください。" },
        { status: 502 }
      );
    }

    // Remove recipients from DB (hard delete) after Stripe sync
    const { error: delError } = await supabaseAdmin
      .from("recipient_emails")
      .delete()
      .in("id", markIds);

    if (delError) {
      console.error("Recipient delete error:", delError);
      return NextResponse.json(
        { error: "メールアドレスの削除に失敗しました" },
        { status: 500 }
      );
    }

    const updatedRows = await fetchRecipientRows(ctx);
    const recipients = toRecipientPayload(updatedRows, ctx.normalizedOwner);

    return NextResponse.json({
      ok: true,
      deleted: markIds.length,
      skipped,
      remaining_addon_count: countActiveAddonRecipients(updatedRows),
      recipients,
    });
  } catch (err) {
    console.error("/api/recipients DELETE error:", err);
    return NextResponse.json({ error: "サーバーエラー" }, { status: 500 });
  }
}

async function adjustStripeForDeletion(rows: RecipientRow[], markIds: number[], userStripeRows: UserStripeRow[]): Promise<boolean> {
  // Build current active addon counts per subscription and removal counts for target rows
  const isAddon = (row: RecipientRow) => (row.created_via ?? "").toLowerCase() === "addon";

  const activeBySub = new Map<string, number>();
  const removeBySub = new Map<string, number>();
  const targetSet = new Set(markIds);

  const subIdByUserStripeId = new Map<number, string>();
  for (const us of userStripeRows) {
    if (us.id && us.stripe_subscription_id) {
      subIdByUserStripeId.set(us.id, us.stripe_subscription_id);
    }
  }

  for (const row of rows) {
    const subId = row.user_stripe_id ? subIdByUserStripeId.get(row.user_stripe_id) : undefined;
    if (!subId) continue;
    if (isAddon(row) && !row.pending_removal) {
      activeBySub.set(subId, (activeBySub.get(subId) ?? 0) + 1);
    }
    if (targetSet.has(row.id) && isAddon(row)) {
      removeBySub.set(subId, (removeBySub.get(subId) ?? 0) + 1);
    }
  }

  if (removeBySub.size === 0) return true; // nothing to do

  const ADDON_PRICE_IDS = new Set(
    [process.env.STRIPE_ADDON_PRICE_ID_LITE, process.env.STRIPE_ADDON_PRICE_ID_BUSINESS]
      .filter((v): v is string => typeof v === "string" && !!v)
  );
  const ADDON_PRODUCT_IDS = new Set(
    [
      ...(process.env.STRIPE_ADDON_PRODUCT_IDS_LITE || "").split(",").map((s) => s.trim()).filter(Boolean),
      ...(process.env.STRIPE_ADDON_PRODUCT_IDS_BUSINESS || "").split(",").map((s) => s.trim()).filter(Boolean),
    ]
  );

  let failed = false;
  for (const [subId, removeCount] of removeBySub.entries()) {
    const current = activeBySub.get(subId) ?? 0;
    const nextQty = Math.max(0, current - removeCount);

    try {
      const sub: any = await stripe.subscriptions.retrieve(subId);
      const items: any[] = Array.isArray(sub?.items?.data) ? sub.items.data : [];
      let addonItem: any | undefined = items.find((it: any) => ADDON_PRICE_IDS.has(it?.price?.id));

      // Priority 2: Product ID match via env
      if (!addonItem && ADDON_PRODUCT_IDS.size > 0) {
        for (const it of items) {
          try {
            const p = it?.price?.product as any;
            const productId: string | undefined = typeof p === "string" ? p : p?.id;
            if (productId && ADDON_PRODUCT_IDS.has(productId)) {
              addonItem = it;
              break;
            }
          } catch {}
        }
      }

      // Fallback: try to detect by product metadata.type === 'add'
      if (!addonItem) {
        for (const it of items) {
          try {
            const p = it?.price?.product as any;
            const productId: string | undefined = typeof p === "string" ? p : p?.id;
            if (!productId) continue;
            const product = await stripe.products.retrieve(productId);
            const t = (product as any)?.metadata?.type;
            if (t && String(t).toLowerCase() === "add") {
              addonItem = it;
              break;
            }
          } catch {}
        }
      }

      if (!addonItem) {
        console.warn("[recipients:DELETE] no addon item found on subscription", subId);
        continue;
      }

      if (nextQty > 0) {
        await stripe.subscriptionItems.update(addonItem.id, { quantity: nextQty });
        console.log("[recipients:DELETE] updated addon quantity", { subId, nextQty });
      } else {
        // If subscription has only the addon item, cancel entire subscription; otherwise remove the item only
        const hasOtherItems = items.some((it) => it.id !== addonItem.id);
        if (hasOtherItems) {
          await stripe.subscriptionItems.del(addonItem.id);
          console.log("[recipients:DELETE] removed addon item from subscription", { subId });
        } else {
          await stripe.subscriptions.cancel(subId);
          console.log("[recipients:DELETE] canceled addon-only subscription", { subId });
        }
      }
    } catch (e) {
      console.warn("[recipients:DELETE] failed to update subscription", { subId, removeCount, nextQty }, e);
      failed = true;
    }
  }
  return !failed;
}

