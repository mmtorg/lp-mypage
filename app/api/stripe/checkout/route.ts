// app/api/stripe/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getLitePriceIds, getBusinessPriceIds, getAddonPriceIdForBasePriceId, getAddonPriceIdForPlan } from "@/lib/stripe-price-ids";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type Stripe from "stripe";

export const runtime = "nodejs";

type Plan = "lite" | "business";

const PRICE_ADDON_LITE_MONTHLY = process.env.STRIPE_ADDON_PRICE_ID_LITE_MONTHLY!;
const PRICE_ADDON_LITE_YEARLY = process.env.STRIPE_ADDON_PRICE_ID_LITE_YEARLY!;
const PRICE_ADDON_BUSINESS_MONTHLY = process.env.STRIPE_ADDON_PRICE_ID_BUSINESS_MONTHLY!;
const PRICE_ADDON_BUSINESS_YEARLY = process.env.STRIPE_ADDON_PRICE_ID_BUSINESS_YEARLY!;

const PL_LITE_MONTHLY = process.env.NEXT_PUBLIC_PL_ADDON_LITE_SEAT_MONTHLY || "";
const PL_LITE_YEARLY = process.env.NEXT_PUBLIC_PL_ADDON_LITE_SEAT_YEARLY || "";
const PL_BUSINESS_MONTHLY = process.env.NEXT_PUBLIC_PL_ADDON_BUS_SEAT_MONTHLY || "";
const PL_BUSINESS_YEARLY = process.env.NEXT_PUBLIC_PL_ADDON_BUS_SEAT_YEARLY || "";

const ACTIVE_STATUSES: Stripe.Subscription.Status[] = [
  "trialing",
  "active",
  "past_due",
  "unpaid",
];

function pickPaymentLink(plan: Plan, interval?: string | null) {
  const isYearly = interval === "year";
  if (plan === "business") {
    return { paymentLink: isYearly ? PL_BUSINESS_YEARLY : PL_BUSINESS_MONTHLY, productLabel: "Business : 配信先追加" } as const;
  }
  return { paymentLink: isYearly ? PL_LITE_YEARLY : PL_LITE_MONTHLY, productLabel: "Lite : 配信先追加" } as const;
}

async function getStripeCustomerIdFromDB(email?: string) {
  if (!email) return undefined;
  const { data, error } = await supabaseAdmin
    .from("user_stripe")
    .select("stripe_customer_id, updated_at")
    .eq("email", email)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[checkout] supabase lookup failed", error);
    return undefined;
  }
  return (data as any)?.stripe_customer_id as string | undefined;
}

async function hasSavedPaymentMethod(customerId: string) {
  const cust = (await stripe.customers.retrieve(customerId)) as Stripe.Customer;
  if (cust?.invoice_settings?.default_payment_method) return true;
  const pms = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
    limit: 1,
  });
  return pms.data.length > 0;
}

async function hasExistingAddonRecipients(email: string): Promise<boolean> {
  if (!email) return false;
  try {
    const { data: userStripeRows, error: userStripeError } =
      await supabaseAdmin.from("user_stripe").select("id").eq("email", email);
    if (userStripeError || !userStripeRows || userStripeRows.length === 0) {
      return false;
    }
    const userStripeIds = userStripeRows.map((row) => row.id);
    const { data: recipientRows, error: recipientError } = await supabaseAdmin
      .from("recipient_emails")
      .select("created_via")
      .in("user_stripe_id", userStripeIds);
    if (recipientError || !recipientRows) {
      return false;
    }
    return recipientRows.some(
      (row) => (row.created_via ?? "").toLowerCase() === "addon"
    );
  } catch (e) {
    console.warn("[checkout] hasExistingAddonRecipients failed", e);
    return false;
  }
}

async function findAnyActiveSubscription(customerId: string) {
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
    expand: ["data.items.data.price"],
  });
  return subs.data.find((s) => ACTIVE_STATUSES.includes(s.status)) ?? null;
}

function findAddonItemsByPrice(
  sub: Stripe.Subscription | null,
  priceId: string
): Stripe.SubscriptionItem[] {
  if (!sub) return [];
  return sub.items.data.filter((it) => {
    const p: any = it.price as any;
    const id = typeof p === "string" ? p : p?.id;
    return id === priceId;
  });
}

function resolveBaseFromSubscription(sub: Stripe.Subscription | null): { plan?: Plan; basePriceId?: string; interval?: "month" | "year" } {
  if (!sub) return {};
  const LITE = new Set(getLitePriceIds());
  const BUS = new Set(getBusinessPriceIds());
  for (const it of sub.items.data) {
    const price: any = it.price as any;
    const id = typeof price === "string" ? price : price?.id;
    const interval = (price?.recurring?.interval || null) as "month" | "year" | null;
    if (id && LITE.has(id)) return { plan: "lite", basePriceId: id, interval: (interval || undefined) as any };
    if (id && BUS.has(id)) return { plan: "business", basePriceId: id, interval: (interval || undefined) as any };
  }
  return {};
}

async function collapseAndPickPrimaryItem(
  sub: Stripe.Subscription,
  matches: Stripe.SubscriptionItem[]
) {
  // “同じ Price の item が複数存在する”場合に合算して一本化
  if (matches.length === 0) return { primary: undefined as any, totalQty: 0 };
  const primary = matches[0];
  const others = matches.slice(1);
  let totalQty = 0;
  for (const it of matches) totalQty += it.quantity ?? 0;
  for (const it of others) {
    try {
      await stripe.subscriptionItems.del(it.id);
    } catch (e) {
      console.warn("[checkout] collapse: delete extra item failed", e);
    }
  }
  return { primary, totalQty };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      plan: Plan;
      quantity: number;
      ownerEmail?: string;
      additionalEmails?: string[];
      precheck?: boolean;
    };

    // 入力正規化
    const plan = body?.plan;
    if (plan !== "lite" && plan !== "business") {
      return NextResponse.json({ error: "invalid plan" }, { status: 400 });
    }

    const quantity = Math.min(10, Math.max(1, Math.floor(Number(body?.quantity))));

    const ownerEmail = (body?.ownerEmail || "").trim() || undefined;
    const additionalEmailsRaw = Array.isArray(body?.additionalEmails)
      ? body.additionalEmails
      : [];

    // Resolve base price and interval strictly from active subscription
    let interval: "month" | "year" | null = null;
    let basePriceId: string | undefined;
    let resolvedPlan: Plan = plan;
    let stripeCustomerId = await getStripeCustomerIdFromDB(ownerEmail);
    let activeSub: Stripe.Subscription | null = null;
    if (stripeCustomerId) {
      activeSub = await findAnyActiveSubscription(stripeCustomerId);
      const base = resolveBaseFromSubscription(activeSub);
      if (base?.interval) interval = base.interval;
      if (base?.basePriceId) basePriceId = base.basePriceId;
      if (base?.plan) resolvedPlan = base.plan;
    } else {
      // 顧客IDが見つからない場合、デフォルトで月次を選択
      interval = "month";
    }

    // 追加メールの有効件数をサーバーで再計算（UIと厳密一致）
    const validAdditionalEmails = additionalEmailsRaw
      .filter((e) => typeof e === "string" && /.+@.+\..+/.test(e.trim()))
      .map((e) => e.trim());

    const requestedQty = validAdditionalEmails.length > 0 ? validAdditionalEmails.length : quantity;
    const qty = Math.min(10, Math.max(1, Math.floor(Number(requestedQty))));

    // Strict mapping: base price id -> addon price id
    let priceId = getAddonPriceIdForBasePriceId(basePriceId, { interval });
    if (!priceId) {
      // Fallback by plan+interval (should not happen if ENV is correct)
      priceId = getAddonPriceIdForPlan(resolvedPlan, interval) as string | undefined;
    }
    if (!priceId) {
      return NextResponse.json({ error: "addon price mapping not found" }, { status: 400 });
    }
    const { paymentLink, productLabel } = pickPaymentLink(resolvedPlan, interval);

    // 価格タイプで Checkout mode を決める（通常は subscription）
    const price = await stripe.prices.retrieve(priceId);
    const mode: "payment" | "subscription" =
      (price as any)?.type === "recurring" ? "subscription" : "payment";

    // URL
    const origin = req.nextUrl.origin;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || origin;
    const success_url = `${baseUrl}/mypage?success=1`;
    const cancel_url = `${baseUrl}/mypage?canceled=1`;

    // メタデータ
    const metadata: Record<string, string> = { plan };
    if (ownerEmail) metadata.owner_email = ownerEmail;
    if (validAdditionalEmails.length > 0) {
      metadata.additional_emails = JSON.stringify(validAdditionalEmails.slice(0, 20));
    }

    // PRECHECK: 副作用ゼロで判定だけ返す
    if (body?.precheck) {
      if (stripeCustomerId) {
        const pmSaved = await hasSavedPaymentMethod(stripeCustomerId);

        if (pmSaved) {
          const sub = activeSub ?? (await findAnyActiveSubscription(stripeCustomerId));
          const priceMatches = findAddonItemsByPrice(sub, priceId);
          const currentQty =
            priceMatches.reduce((s, it) => s + (it.quantity ?? 0), 0) ?? 0;
          return NextResponse.json({
            canFinalizeSilently: true,
            currentQuantity: currentQty,
          });
        }

        // 強制リダイレクトケース
        const cs = await stripe.checkout.sessions.create({
          mode,
          line_items: [
            {
              price: priceId,
              quantity: qty,
              adjustable_quantity: { enabled: true, minimum: 1, maximum: 10 },
            },
          ],
          success_url: `${baseUrl}/mypage?success=1&cs_id={CHECKOUT_SESSION_ID}`,
          cancel_url,
          customer: stripeCustomerId,
          customer_email: stripeCustomerId ? undefined : ownerEmail,
          metadata,
        });
        return NextResponse.json({
          url: (cs as any)?.url,
          isPaymentLink: false,
          openInSameTab: true,
        });
      }

      // 顧客不明：Payment Link か Checkout を作るだけ
      if (paymentLink) {
        return NextResponse.json({
          url: paymentLink,
          isPaymentLink: true,
          openInSameTab: true,
        });
      }
      const cs = await stripe.checkout.sessions.create({
        mode,
        line_items: [
          {
            price: priceId,
            quantity: qty,
            adjustable_quantity: { enabled: true, minimum: 1, maximum: 10 },
          },
        ],
        success_url,
        cancel_url,
        customer: stripeCustomerId,
        customer_email: stripeCustomerId ? undefined : ownerEmail,
        metadata,
      });
      return NextResponse.json({
        url: (cs as any)?.url,
        isPaymentLink: false,
        openInSameTab: true,
      });
    }

    // 本処理（更新を行う）
    if (!stripeCustomerId) {
      if (paymentLink) {
        return NextResponse.json({ url: paymentLink, isPaymentLink: true, openInSameTab: true });
      }
      const cs = await stripe.checkout.sessions.create({
        mode,
        line_items: [
          { price: priceId, quantity: qty, adjustable_quantity: { enabled: true, minimum: 1, maximum: 10 } },
        ],
        success_url,
        cancel_url,
        customer_email: ownerEmail,
        metadata,
      });
      return NextResponse.json({ url: (cs as any)?.url, isPaymentLink: false, openInSameTab: true });
    }

    const pmSaved = await hasSavedPaymentMethod(stripeCustomerId);
    const sub = await findAnyActiveSubscription(stripeCustomerId);
    if (!pmSaved || !sub) {
      if (paymentLink) {
        return NextResponse.json({ url: paymentLink, isPaymentLink: true, openInSameTab: true });
      }
      const cs = await stripe.checkout.sessions.create({
        mode,
        line_items: [
          { price: priceId, quantity: qty, adjustable_quantity: { enabled: true, minimum: 1, maximum: 10 } },
        ],
        success_url,
        cancel_url,
        customer: stripeCustomerId,
        metadata,
      });
      return NextResponse.json({ url: (cs as any)?.url, isPaymentLink: false, openInSameTab: true });
    }

    // 非遷移で確定
    const priceMatches = findAddonItemsByPrice(sub, priceId);
    const { primary, totalQty } = await collapseAndPickPrimaryItem(sub, priceMatches);

    const previousQuantity = totalQty ?? 0;
    const newQuantity = previousQuantity + qty;

    // 追加メールを recipient_emails に保存する補助
    async function upsertRecipientsForAddons(opts: {
      customerId: string;
      ownerEmail?: string;
      plan: Plan;
      emails: string[];
    }) {
      const emails = Array.from(new Set((opts.emails || []).filter((e) => /.+@.+\..+/.test(e)))) as string[];
      if (emails.length === 0) return;
      let email = (opts.ownerEmail || "").trim() || undefined;
      if (!email) {
        try {
          email = ((await stripe.customers.retrieve(opts.customerId)) as any)?.email ?? undefined;
        } catch {}
      }
      // 親 user_stripe の解決（customer 基準、最新を採用）
      let parentId: number | undefined;
      const nowIso = new Date().toISOString();
      try {
        const found = await supabaseAdmin
          .from("user_stripe")
          .select("id")
          .eq("stripe_customer_id", opts.customerId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!found.error && found.data?.id) {
          parentId = found.data.id;
          if (email) {
            await supabaseAdmin.from("user_stripe").update({ email, updated_at: nowIso }).eq("id", parentId);
          }
        } else if (email) {
          const ins = await supabaseAdmin
            .from("user_stripe")
            .insert({ email, stripe_customer_id: opts.customerId, updated_at: nowIso })
            .select("id")
            .maybeSingle();
          parentId = ins.data?.id as number | undefined;
        }
      } catch (e) {
        console.warn("[checkout] upsertRecipients: parent resolve failed", e);
      }
      if (!parentId) return;
      const rows = emails.map((em) => ({ email: em, user_stripe_id: parentId!, plan: opts.plan, created_via: "addon" }));
      // Do not overwrite existing recipient rows; only insert if not exists
      const { error } = await supabaseAdmin
        .from("recipient_emails")
        .upsert(rows, { onConflict: "email", ignoreDuplicates: true });
      if (error) console.error("[checkout] upsertRecipients error", error);
    }

    if (primary) {
      // 既存 item の数量を加算
      const updated = await stripe.subscriptionItems.update(primary.id, {
        quantity: newQuantity,
        proration_behavior: "create_prorations",
      });
      if (validAdditionalEmails.length > 0 && stripeCustomerId) {
        await upsertRecipientsForAddons({ customerId: stripeCustomerId, ownerEmail, plan, emails: validAdditionalEmails });
      }
      const portal = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: `${baseUrl}/mypage?updated=1`,
      });
      return NextResponse.json({
        updated: true,
        portalUrl: (portal as any)?.url,
        productName: productLabel,
        newQuantity: updated.quantity ?? newQuantity,
        addedQuantity: qty,
        previousQuantity,
      });
    } else {
      // 同じ Price の item が無ければ新規作成
      const created = await stripe.subscriptionItems.create({
        subscription: sub.id,
        price: priceId,
        quantity: qty,
        proration_behavior: "create_prorations",
      });
      if (validAdditionalEmails.length > 0 && stripeCustomerId) {
        await upsertRecipientsForAddons({ customerId: stripeCustomerId, ownerEmail, plan, emails: validAdditionalEmails });
      }
      const portal = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: `${baseUrl}/mypage?updated=1`,
      });
      return NextResponse.json({
        updated: true,
        portalUrl: (portal as any)?.url,
        productName: productLabel,
        newQuantity: created.quantity ?? qty,
        addedQuantity: qty,
        previousQuantity,
      });
    }
  } catch (e: any) {
    console.error("/api/stripe/checkout error:", e);
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
