import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { stripe } from "@/lib/stripe";

type Plan = "lite" | "business" | "trial" | null;

const ACTIVE_STATUSES = new Set(
  (process.env.SUBSCRIPTION_VALID_STATUSES || "active,trialing,past_due,unpaid")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

function envList(name: string): string[] {
  return String(process.env[name] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Collect all addon price ids we consider as seat add-ons
const ADDON_PRICE_IDS = new Set(
  [
    process.env.STRIPE_ADDON_PRICE_ID_LITE_MONTHLY,
    process.env.STRIPE_ADDON_PRICE_ID_LITE_YEARLY,
    process.env.STRIPE_ADDON_PRICE_ID_BUSINESS_MONTHLY,
    process.env.STRIPE_ADDON_PRICE_ID_BUSINESS_YEARLY,
    ...envList("STRIPE_ADDON_PRICE_IDS"),
  ].filter((v): v is string => typeof v === "string" && !!v)
);

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const email = (searchParams.get("email") || "").trim();
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

    // Resolve plan and stripe_customer_id, collect parent ids
    const { data: usRows, error: usErr } = await supabaseAdmin
      .from("user_stripe")
      .select("id, current_plan, stripe_customer_id, updated_at")
      .eq("email", email);
    if (usErr) {
      console.warn("[limits] user_stripe query error", usErr);
    }

    // 同一emailで trial と lite/business が併存する場合は lite/business を優先
    const rows = (usRows ?? []) as Array<{ id: number; current_plan: Plan | null; stripe_customer_id?: string | null; updated_at?: string }>
    const rank = (p: Plan | null | undefined) => (p === "business" ? 3 : p === "lite" ? 2 : p === "trial" ? 1 : 0);
    const prioritized = rows
      .slice()
      .sort((a, b) => {
        const r = rank(b.current_plan) - rank(a.current_plan);
        if (r !== 0) return r;
        // 同順位は updated_at の新しい方を優先（念のため）
        const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return tb - ta;
      })[0];
    const plan: Plan = (prioritized?.current_plan as Plan) ?? null;
    const stripeCustomerId: string | undefined = prioritized?.stripe_customer_id || undefined;
    const parentIds: number[] = prioritized?.id ? [prioritized.id] : [];

    // Base slots from plan_limits; fallback defaults (lite=1, business=4)
    let baseSlots = 0;
    if (plan === "lite" || plan === "business") {
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
    }

    // Addon slots: sum of quantities of addon price ids on active subs
    let addonSlots = 0;
    if (stripeCustomerId && ADDON_PRICE_IDS.size > 0) {
      try {
        const subs = await stripe.subscriptions.list({ customer: stripeCustomerId, status: "all", limit: 50, expand: ["data.items.data.price"] });
        for (const s of subs.data) {
          const status = String((s as any)?.status || "").toLowerCase();
          if (!ACTIVE_STATUSES.has(status)) continue;
          const items: any[] = Array.isArray((s as any)?.items?.data) ? (s as any).items.data : [];
          for (const it of items) {
            const priceId: string | undefined = typeof it?.price === "string" ? (it?.price as any) : (it?.price?.id as string | undefined);
            if (priceId && ADDON_PRICE_IDS.has(priceId)) {
              addonSlots += Number(it?.quantity || 0);
            }
          }
        }
      } catch (e) {
        console.warn("[limits] stripe subscriptions list failed", e);
      }
    }

    // Used slots = owner(1) + number of active recipients (exclude pending_removal)
    // 契約者本人も配信先に含まれる仕様。
    // ただし recipient_emails に既に契約者が含まれている場合は二重計上しない。
    let usedSlots = 0;
    if (parentIds.length > 0) {
      try {
        const { data: recs } = await supabaseAdmin
          .from("recipient_emails")
          .select("id, email, pending_removal")
          .in("user_stripe_id", parentIds);
        const active = (recs ?? []).filter((r: any) => !r?.pending_removal);
        const activeCount = active.length;
        const hasOwner = active.some(
          (r: any) => String(r?.email || "").toLowerCase() === email.toLowerCase()
        );
        const ownerCount = plan === "lite" || plan === "business" ? (hasOwner ? 0 : 1) : 0;
        usedSlots = ownerCount + activeCount;
      } catch {}
    }

    const total = baseSlots + addonSlots;
    const remaining = Math.max(0, total - usedSlots);

    return NextResponse.json({
      plan,
      base_slots: baseSlots,
      addon_slots: addonSlots,
      used_slots: usedSlots,
      remaining_slots: remaining,
    });
  } catch (e) {
    console.error("/api/me/limits error", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
