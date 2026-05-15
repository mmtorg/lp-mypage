import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { stripe } from "@/lib/stripe";

type Plan = "lite" | "business" | "trial" | null;

function isEmail(str: string): boolean {
  return /.+@.+\..+/.test(str);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

type UserStripeRow = {
  id: number;
  email: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_plan: Plan;
  updated_at: string;
};

type RecipientRow = {
  id: number;
  email: string | null;
  created_via: string | null;
  user_stripe_id: number | null;
  pending_removal: boolean | null;
};

async function resolveOwnerContext(ownerEmailRaw: string) {
  const ownerEmail = ownerEmailRaw.trim();
  const normalizedOwner = normalizeEmail(ownerEmail);
  let plan: Plan = null;
  let userStripeRows: UserStripeRow[] = [];

  try {
    const { data, error } = await supabaseAdmin
      .from("user_stripe")
      .select(
        "id, email, stripe_customer_id, stripe_subscription_id, current_plan, updated_at"
      )
      .eq("email", ownerEmail);
    if (error) throw error;
    userStripeRows = (data ?? []) as UserStripeRow[];
    if (!userStripeRows.length) {
      const { data: recs } = await supabaseAdmin
        .from("recipient_emails")
        .select("user_stripe_id")
        .eq("email", ownerEmail);
      const ids = Array.from(
        new Set((recs ?? []).map((r: any) => r?.user_stripe_id).filter((v: any) => typeof v === "number"))
      );
      if (ids.length) {
        const { data: fromLink } = await supabaseAdmin
          .from("user_stripe")
          .select(
            "id, email, stripe_customer_id, stripe_subscription_id, current_plan, updated_at"
          )
          .in("id", ids);
        userStripeRows = (fromLink ?? []) as UserStripeRow[];
      }
    }
    if (userStripeRows.length) {
      const rank = (p: Plan | null | undefined) =>
        p === "business" ? 3 : p === "lite" ? 2 : p === "trial" ? 1 : 0;
      const prioritized = [...userStripeRows].sort((a, b) => {
        const r = rank(b.current_plan) - rank(a.current_plan);
        if (r !== 0) return r;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      })[0];
      plan = (prioritized?.current_plan as Plan) ?? null;
    } else {
      plan = null;
    }
  } catch (err) {
    console.warn("[free-add] resolveOwnerContext failed", err);
  }

  return { ownerEmail, normalizedOwner, plan, userStripeRows };
}

async function fetchRecipientRows(parentIds: number[]): Promise<RecipientRow[]> {
  if (!parentIds.length) return [];
  const { data, error } = await supabaseAdmin
    .from("recipient_emails")
    .select("id, email, created_via, pending_removal, user_stripe_id")
    .in("user_stripe_id", parentIds);
  if (error) throw error;
  return (data ?? []) as RecipientRow[];
}

export async function POST(req: NextRequest) {
  const requestId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  let logContext: Record<string, unknown> = {
    requestId,
    route: "/api/recipients/free-add",
  };

  const fail = (
    status: number,
    body: Record<string, unknown>,
    details?: Record<string, unknown>
  ) => {
    console.error("[free-add] request failed", {
      ...logContext,
      status,
      error: body.error,
      ...details,
    });
    return NextResponse.json({ ...body, request_id: requestId }, { status });
  };

  try {
    const body = (await req.json()) as {
      ownerEmail: string;
      emails: string[];
    };

    const ownerEmail = (body?.ownerEmail || "").trim();
    const emails = Array.isArray(body?.emails) ? body.emails : [];
    logContext = {
      ...logContext,
      ownerEmail,
      requestedEmailCount: emails.length,
      requestedEmails: emails,
    };

    if (!ownerEmail || !isEmail(ownerEmail)) {
      return fail(
        400,
        { error: "所有者のメールアドレスが不正です" },
        { ownerEmailPresent: Boolean(ownerEmail) }
      );
    }
    const cleaned = emails
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter((v) => v && isEmail(v));
    if (cleaned.length !== emails.length) {
      return fail(
        400,
        { error: "メールアドレスの形式が正しくありません" },
        { cleanedEmailCount: cleaned.length }
      );
    }
    if (cleaned.length === 0) {
      return fail(400, { error: "追加するメールがありません" });
    }

    const ctx = await resolveOwnerContext(ownerEmail);
    if (!ctx.userStripeRows.length) {
      return fail(404, { error: "契約情報が見つかりませんでした" });
    }
    logContext = {
      ...logContext,
      resolvedPlan: ctx.plan,
      userStripeIds: ctx.userStripeRows.map((row) => row.id),
    };
    // 有効プランは lite / business のみ対象
    const plan = ctx.plan;
    if (plan !== "lite" && plan !== "business") {
      return fail(
        400,
        { error: "有効なプランがありません（lite / businessのみ追加可能）" },
        { resolvedPlan: plan }
      );
    }

    // 代表親を決める（lite/business > trial，更新新しい順）
    const parent = [...ctx.userStripeRows].sort((a, b) => {
      const rank = (p: Plan | null | undefined) =>
        p === "business" ? 3 : p === "lite" ? 2 : p === "trial" ? 1 : 0;
      const r = rank(b.current_plan) - rank(a.current_plan);
      if (r !== 0) return r;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    })[0];

    const stripeCustomerId: string | undefined = parent?.stripe_customer_id || undefined;
    logContext = {
      ...logContext,
      parentUserStripeId: parent?.id,
      stripeCustomerId,
      stripeSubscriptionId: parent?.stripe_subscription_id,
    };

    // 1) base slots from plan_limits (fallback: lite=1, business=4)
    let baseSlots = 0;
    try {
      const { data: lim } = await supabaseAdmin
        .from("plan_limits")
        .select("base_recipient_slots")
        .eq("plan", plan)
        .maybeSingle();
      if (lim?.base_recipient_slots != null) {
        baseSlots = Number(lim.base_recipient_slots) || 0;
      } else {
        baseSlots = plan === "business" ? 4 : 1;
      }
    } catch {
      baseSlots = plan === "business" ? 4 : 1;
    }

    // 2) addon slots from Stripe subscription items (active-like statuses)
    const ACTIVE_STATUSES = new Set(
      (process.env.SUBSCRIPTION_VALID_STATUSES || "active,trialing,past_due,unpaid")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    );
    const ADDON_PRICE_IDS = new Set(
      [
        process.env.STRIPE_ADDON_PRICE_ID_LITE_MONTHLY,
        process.env.STRIPE_ADDON_PRICE_ID_BUSINESS_MONTHLY,
      ].filter((v): v is string => typeof v === "string" && !!v)
    );

    let addonSlots = 0;
    if (stripeCustomerId && ADDON_PRICE_IDS.size > 0) {
      try {
        const subs = await stripe.subscriptions.list({
          customer: stripeCustomerId,
          status: "all",
          limit: 50,
          expand: ["data.items.data.price"],
        });
        for (const s of subs.data) {
          const status = String((s as any)?.status || "").toLowerCase();
          if (!ACTIVE_STATUSES.has(status)) continue;
          const items: any[] = Array.isArray((s as any)?.items?.data)
            ? (s as any).items.data
            : [];
          for (const it of items) {
            const priceId: string | undefined =
              typeof it?.price === "string" ? (it?.price as any) : (it?.price?.id as string | undefined);
            if (priceId && ADDON_PRICE_IDS.has(priceId)) {
              addonSlots += Number(it?.quantity || 0);
            }
          }
        }
      } catch (e) {
        console.warn("[free-add] stripe subscriptions list failed", e);
      }
    }

    // 3) current usage and labeling state
    const rows = await fetchRecipientRows([parent.id]);
    const activeRows = rows.filter((r) => !r.pending_removal);
    // 使用中スロットは「契約者(1) + アクティブな配信先数」。
    // ただし recipient_emails に既に契約者が含まれている場合は二重計上しない。
    const hasOwner = activeRows.some(
      (r) => String(r.email || "").toLowerCase() === ctx.normalizedOwner
    );
    const ownerCount = hasOwner ? 0 : 1;
    const usedSlots = ownerCount + activeRows.length;
    const addonCount = activeRows.filter((r) => (r.created_via ?? "").toLowerCase() === "addon").length;
    // initialCount には契約者分(1)も含める（ベース枠に含まれるため）
    const initialCount = usedSlots - addonCount;

    const totalAllowed = baseSlots + addonSlots;
    const remaining = Math.max(0, totalAllowed - usedSlots);
    if (cleaned.length > remaining) {
      return fail(
        400,
        { error: `追加可能な残り枠は ${remaining} 件です`, remaining_slots: remaining },
        {
          cleanedEmailCount: cleaned.length,
          baseSlots,
          addonSlots,
          usedSlots,
          remaining,
        }
      );
    }

    // Decide created_via for new rows: prioritize filling addon labels to match addonSlots
    const neededAddonLabels = Math.max(0, addonSlots - addonCount);
    const uniqueEmails = Array.from(new Set(cleaned.map(normalizeEmail)));

    // Prevent duplicates within parent
    const existingSet = new Set(activeRows.map((r) => (r.email || "").toLowerCase()).filter(Boolean));
    const toInsert: { email: string; created_via: "initial" | "addon" }[] = [];
    for (const em of uniqueEmails) {
      if (!em) continue;
      if (existingSet.has(em)) {
        return fail(
          409,
          { error: `既に登録済みのメールがあります: ${em}` },
          { duplicateEmail: em }
        );
      }
      const via: "initial" | "addon" = toInsert.length < neededAddonLabels ? "addon" : "initial";
      toInsert.push({ email: em, created_via: via });
    }

    // Safety: ensure initial does not exceed baseSlots
    const initialAdds = toInsert.filter((r) => r.created_via === "initial").length;
    if (initialCount + initialAdds > baseSlots) {
      return fail(
        400,
        { error: "無料枠（ベース枠）を超える追加はできません" },
        { initialCount, initialAdds, baseSlots }
      );
    }

    const rowsToUpsert = toInsert.map((r) => ({
      email: r.email,
      user_stripe_id: parent.id,
      plan,
      created_via: r.created_via,
      pending_removal: false,
    }));

    const { error: upErr } = await supabaseAdmin
      .from("recipient_emails")
      .upsert(rowsToUpsert, { onConflict: "user_stripe_id,email", ignoreDuplicates: true });
    if (upErr) {
      return fail(
        500,
        { error: "配信先の保存に失敗しました" },
        { upsertError: upErr, rowsToUpsert }
      );
    }

    return NextResponse.json({ ok: true, inserted: rowsToUpsert.length });
  } catch (err) {
    console.error("[free-add] unhandled error", {
      ...logContext,
      error: err,
    });
    return NextResponse.json(
      { error: "サーバーエラー", request_id: requestId },
      { status: 500 }
    );
  }
}

