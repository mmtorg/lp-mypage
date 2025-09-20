import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Plan = "lite" | "business" | null;

type PurchasedItem = {
  name: string;
  quantity: number;
  type: "base" | "addon";
  price_id?: string;
  product_id?: string;
};

type RecipientInfo = {
  email: string;
  created_via: "initial" | "addon" | null;
  is_owner: boolean;
  pending_removal: boolean;
};

function inferItemType(product: any): "base" | "addon" {
  const rawType = ((product as any)?.metadata?.type ?? (product as any)?.metadata?.category ?? "")
    .toString()
    .toLowerCase();
  if (["addon", "add_on", "add-on", "add"].includes(rawType)) return "addon";
  return "base";
}

async function collectSubscriptionItems(sub: any): Promise<{ items: PurchasedItem[]; primaryName?: string }> {
  const rawItems: any[] = Array.isArray(sub?.items?.data) ? sub.items.data : [];
  if (!rawItems.length) return { items: [], primaryName: undefined };

  const productCache = new Map<string, any>();
  const items: PurchasedItem[] = [];

  for (const item of rawItems) {
    const price: any = item?.price ?? {};
    const prodAny = price?.product;
    const productId: string | undefined = typeof prodAny === "string" ? prodAny : prodAny?.id;

    let product: any | undefined = undefined;
    if (productId) {
      if (productCache.has(productId)) {
        product = productCache.get(productId);
      } else {
        try {
          product = await safeStripeCall(() => stripe.products.retrieve(productId), `products.retrieve:${productId}`);
          productCache.set(productId, product);
        } catch (err) {
          console.warn("[sub-by-email] failed to fetch product", productId, err);
        }
      }
    } else if (prodAny) {
      product = prodAny;
    }

    const quantity = typeof item?.quantity === "number" && !Number.isNaN(item.quantity) ? item.quantity : 1;
    const name =
      (product as any)?.name ??
      price?.nickname ??
      (typeof price?.product === "string" ? price.product : price?.id ?? "不明な商品");

    items.push({
      name,
      quantity,
      type: inferItemType(product),
      price_id: price?.id,
      product_id: productId,
    });
  }

  const primaryName = items.find((item) => item.type === "base")?.name ?? items[0]?.name;
  return { items, primaryName };
}

function envList(name: string): string[] {
  const v = process.env[name];
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Product ID mapping for plan detection
const LITE_PRODUCT_IDS = envList("STRIPE_PRODUCT_IDS_LITE");
const BUSINESS_PRODUCT_IDS = envList("STRIPE_PRODUCT_IDS_BUSINESS");
const VALID_STATUSES = new Set(
  envList("SUBSCRIPTION_VALID_STATUSES").map((s) => s.toLowerCase())
);
if (VALID_STATUSES.size === 0) {
  VALID_STATUSES.add("active");
  VALID_STATUSES.add("trialing");
}

async function inferPlanFromSubscription(sub: any): Promise<Plan> {
  try {
    const item = sub?.items?.data?.[0];
    const p = item?.price?.product as any;
    const productId: string | undefined = typeof p === "string" ? p : p?.id;
    if (productId) {
      if (LITE_PRODUCT_IDS.includes(productId)) return "lite";
      if (BUSINESS_PRODUCT_IDS.includes(productId)) return "business";
    }
    if (productId) {
      const product = await stripe.products.retrieve(productId);
      const name = ((product as any)?.name || "").toLowerCase();
      if (name.includes("lite")) return "lite";
      if (name.includes("business")) return "business";
    }
  } catch {}
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const email = (searchParams.get("email") || "").trim();
    const force = searchParams.get("force") === "1";
    const debugMode = searchParams.get("debug") === "1";
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

    const ttlSec = Number(process.env.SUBSCRIPTION_CACHE_TTL_SECONDS || 600);
    const now = Date.now();
    const debug: any = debugMode ? { step: "start", email, ttlSec } : undefined;
    if (debugMode) {
      console.log("[sub-by-email] start", { email, ttlSec, force });
      console.log("[sub-by-email] mappings", { LITE_PRODUCT_IDS, BUSINESS_PRODUCT_IDS });
    }

    // Cache lookup in user_stripe
    try {
      const { data: cached } = await supabaseAdmin
        .from("user_stripe")
        .select("current_plan, email, updated_at, stripe_customer_id")
        .eq("email", email)
        .maybeSingle();
      if (debugMode) debug.cached = cached ?? null;

      if (!force && cached?.current_plan) {
        if (debugMode) console.log("[sub-by-email] hit cache(non-null)", { cached });
        let productName: string | undefined;
        let addon_unit_amount: number | undefined;
        let addon_currency: string | undefined;
        let recipients: RecipientInfo[] = [];
    let purchasedItems: PurchasedItem[] = [];
        try {
          if (cached.stripe_customer_id) {
            const all = await safeStripeCall(
              () => stripe.subscriptions.list({ customer: cached.stripe_customer_id, status: "all", limit: 10 }),
              "subscriptions.list"
            );
            const valids = all.data.filter((s) => VALID_STATUSES.has(String(s.status).toLowerCase()));
            let primaryCaptured = false;
            for (const sub of valids) {
              const { items, primaryName } = await collectSubscriptionItems(sub);
              purchasedItems.push(...items);
              if (!primaryCaptured && primaryName) {
                productName = primaryName;
                primaryCaptured = true;
              }
            }
          }
        } catch {}
        try {
          const addonPriceId =
            (cached.current_plan === "lite" && process.env.STRIPE_ADDON_PRICE_ID_LITE) ||
            (cached.current_plan === "business" && process.env.STRIPE_ADDON_PRICE_ID_BUSINESS) ||
            undefined;
          if (addonPriceId) {
            const pr = await safeStripeCall(() => stripe.prices.retrieve(addonPriceId), "prices.retrieve");
            addon_unit_amount = (pr as any)?.unit_amount ?? undefined;
            addon_currency = (pr as any)?.currency ?? undefined;
          }
        } catch {}
        try {
          recipients = await fetchRecipients(cached.stripe_customer_id ?? undefined, cached.email ?? undefined);
        } catch (err) {
          console.warn("[sub-by-email] failed to fetch recipients (cache)", err);
        }
        return NextResponse.json({
          current_plan: cached.current_plan,
          email,
          product_name: productName,
          addon_unit_amount,
          addon_currency,
          recipients,
          purchased_items: purchasedItems,
        });
      }

      if (!force && cached?.updated_at) {
        const ageMs = now - new Date(cached.updated_at as any).getTime();
        if (ageMs <= ttlSec * 1000 && cached.current_plan) {
          if (debugMode) console.log("[sub-by-email] hit cache(non-null)", { ageMs, cached });
          let productName: string | undefined;
          let addon_unit_amount: number | undefined;
          let addon_currency: string | undefined;
          let recipients: RecipientInfo[] = [];
        let purchasedItems: PurchasedItem[] = [];
          try {
            if (cached.stripe_customer_id) {
              const all = await safeStripeCall(
                () => stripe.subscriptions.list({ customer: cached.stripe_customer_id, status: "all", limit: 10 }),
                "subscriptions.list"
              );
              const valids = all.data.filter((s) => VALID_STATUSES.has(String(s.status).toLowerCase()));
              let primaryCaptured = false;
              for (const sub of valids) {
                const { items, primaryName } = await collectSubscriptionItems(sub);
                purchasedItems.push(...items);
                if (!primaryCaptured && primaryName) {
                  productName = primaryName;
                  primaryCaptured = true;
                }
              }
            }
          } catch {}
          try {
            const addonPriceId =
              (cached.current_plan === "lite" && process.env.STRIPE_ADDON_PRICE_ID_LITE) ||
              (cached.current_plan === "business" && process.env.STRIPE_ADDON_PRICE_ID_BUSINESS) ||
              undefined;
            if (addonPriceId) {
              const pr = await safeStripeCall(() => stripe.prices.retrieve(addonPriceId), "prices.retrieve");
              addon_unit_amount = (pr as any)?.unit_amount ?? undefined;
              addon_currency = (pr as any)?.currency ?? undefined;
            }
          } catch {}
          try {
            recipients = await fetchRecipients(cached.stripe_customer_id ?? undefined, cached.email ?? undefined);
          } catch (err) {
            console.warn("[sub-by-email] failed to fetch recipients (cache)", err);
          }
          return NextResponse.json({
            current_plan: cached.current_plan,
            email,
            product_name: productName,
            addon_unit_amount,
            addon_currency,
            recipients,
            purchased_items: purchasedItems,
          });
        } else if (debugMode) {
          console.log("[sub-by-email] bypass cache (stale or null)", { ageMs, cachedPlan: cached.current_plan });
        }
      }
    } catch {}

    // Stripe customer search
    const searchLimit = Number(process.env.STRIPE_CUSTOMER_SEARCH_LIMIT || 3);
    const customers = await safeStripeCall(
      () =>
        stripe.customers.search({
          query: `email:'${email.replace(/'/g, " ")}'`,
          limit: isFinite(searchLimit) ? searchLimit : 3,
        }),
      "customers.search"
    );
    if (debugMode) {
      console.log(
        "[sub-by-email] customers",
        customers.data.map((c) => ({ id: c.id, email: (c as any).email }))
      );
      if (debug) debug.customers = customers.data.map((c) => ({ id: c.id, email: (c as any).email }));
    }
    if (!customers.data.length) {
      if (debugMode) console.log("[sub-by-email] no customers found for email");
      return NextResponse.json({ current_plan: null, email, recipients: [], purchased_items: [] });
    }

    // Collect all valid subscriptions (across customers)
    let currentPlan: Plan = null;
    let stripeCustomerIdForLink: string | undefined;
    let productName: string | undefined;
    let recipients: RecipientInfo[] = [];
    let purchasedItems: PurchasedItem[] = [];
    let primaryCaptured = false;
    let hasBusiness = false;
    let hasLite = false;
    for (const c of customers.data) {
      const all = await safeStripeCall(
        () => stripe.subscriptions.list({ customer: c.id, status: "all", limit: 10 }),
        "subscriptions.list"
      );
      if (debugMode) {
        console.log(
          "[sub-by-email] all subs statuses",
          all.data.map((s) => ({ id: s.id, status: s.status }))
        );
      }
      const valids = all.data.filter((s) => VALID_STATUSES.has(String(s.status).toLowerCase()));
      for (const sub of valids) {
        try {
          const inferred = await inferPlanFromSubscription(sub);
          if (inferred === "business") hasBusiness = true;
          if (inferred === "lite") hasLite = true;
          const described = await collectSubscriptionItems(sub);
          purchasedItems.push(...described.items);
          if (!primaryCaptured && described.primaryName) {
            productName = described.primaryName;
            primaryCaptured = true;
          }
          if (!stripeCustomerIdForLink) {
            const custAny = (sub as any).customer;
            stripeCustomerIdForLink = typeof custAny === "string" ? custAny : custAny?.id || c.id;
          }
        } catch {}
      }
    }
    // Decide representative plan for UI (prefer business if any)
    currentPlan = hasBusiness ? "business" : hasLite ? "lite" : null;

    // Upsert user_stripe (no Supabase Auth) and ensure owner recipient
    let upsertedUserStripeId: number | undefined;
    if (stripeCustomerIdForLink || currentPlan) {
      const upsertPayload: Record<string, any> = {
        email,
        updated_at: new Date().toISOString(),
      };
      if (stripeCustomerIdForLink) upsertPayload.stripe_customer_id = stripeCustomerIdForLink;
      if (currentPlan) upsertPayload.current_plan = currentPlan;
      // 紐付け対象のサブスクリプションIDがあれば保存
      try {
        const chosenSubId: string | undefined = (customers?.data ?? [])
          .flatMap((c) => []) && undefined; // placeholder, set below
      } catch {}
      // We already have the chosen subscription in the loop above; find it again for id
      // For simplicity, re-query one active subscription for the chosen customer
      let chosenSubscriptionId: string | undefined;
      if (stripeCustomerIdForLink) {
        try {
          const all = await safeStripeCall(
            () => stripe.subscriptions.list({ customer: stripeCustomerIdForLink, status: "all", limit: 10 }),
            "subscriptions.list"
          );
          const chosen = all.data.find((s) => VALID_STATUSES.has(String(s.status).toLowerCase()));
          chosenSubscriptionId = chosen?.id ?? undefined;
        } catch {}
      }
      if (chosenSubscriptionId) upsertPayload.stripe_subscription_id = chosenSubscriptionId;

      const { data: upserted, error: upErr } = await supabaseAdmin
        .from("user_stripe")
        .upsert(upsertPayload, { onConflict: "stripe_subscription_id" })
        .select("id, stripe_subscription_id")
        .maybeSingle();
      if (!upErr) upsertedUserStripeId = upserted?.id as number | undefined;
    }

    if (currentPlan && upsertedUserStripeId) {
      await supabaseAdmin
        .from("recipient_emails")
        .upsert(
          [
            {
              email,
              plan: currentPlan,
              user_stripe_id: upsertedUserStripeId,
            },
          ],
          { onConflict: "email", ignoreDuplicates: true }
        );
    }

    try {
      recipients = await fetchRecipients(stripeCustomerIdForLink, email);
    } catch (err) {
      console.warn("[sub-by-email] failed to fetch recipients", err);
      recipients = [];
    }

    // Add-on price lookup for UI (optional)
    let addon_unit_amount: number | undefined;
    let addon_currency: string | undefined;
    try {
      const addonPriceId =
        (currentPlan === "lite" && process.env.STRIPE_ADDON_PRICE_ID_LITE) ||
        (currentPlan === "business" && process.env.STRIPE_ADDON_PRICE_ID_BUSINESS) ||
        undefined;
      if (addonPriceId) {
        const pr = await safeStripeCall(() => stripe.prices.retrieve(addonPriceId), "prices.retrieve");
        addon_unit_amount = (pr as any)?.unit_amount ?? undefined;
        addon_currency = (pr as any)?.currency ?? undefined;
      }
    } catch {}

    if (debugMode) console.log("[sub-by-email] done", { email, currentPlan, productName, addon_unit_amount, addon_currency, purchasedCount: purchasedItems.length });
    if (debugMode && debug) {
      debug.valid_statuses = Array.from(VALID_STATUSES.values());
      debug.purchased_items = purchasedItems;
    }
    return NextResponse.json(
      debugMode
        ? {
            current_plan: currentPlan,
            email,
            product_name: productName,
            addon_unit_amount,
            addon_currency,
            recipients,
            purchased_items: purchasedItems,
            debug,
          }
        : {
            current_plan: currentPlan,
            email,
            product_name: productName,
            addon_unit_amount,
            addon_currency,
            recipients,
            purchased_items: purchasedItems,
          }
    );
  } catch (e) {
    console.error("subscription-by-email error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

async function fetchRecipients(stripeCustomerId?: string, ownerEmail?: string): Promise<RecipientInfo[]> {
  if (!stripeCustomerId && !ownerEmail) return [];

  const normalizedOwner = ownerEmail ? ownerEmail.toLowerCase() : null;
  const collected = new Map<string, RecipientInfo>();

  const upsert = (email: string | null | undefined, via: string | null | undefined, pending?: boolean | null) => {
    if (!email) return;
    const key = email.toLowerCase();
    const mappedVia = via === "addon" || via === "initial" ? (via as "addon" | "initial") : null;
    const pendingRemoval = Boolean(pending);
    const existing = collected.get(key);
    const isOwner = normalizedOwner ? key === normalizedOwner : false;
    if (!existing) {
      collected.set(key, {
        email,
        created_via: mappedVia,
        is_owner: isOwner,
        pending_removal: pendingRemoval,
      });
      return;
    }
    const next: RecipientInfo = {
      ...existing,
      created_via: existing.created_via ?? mappedVia ?? null,
      is_owner: existing.is_owner || isOwner,
      pending_removal: existing.pending_removal || pendingRemoval,
    };
    collected.set(key, next);
  };

  if (stripeCustomerId) {
    // customer に紐づく user_stripe → そこから recipient_emails
    const { data: parents, error: pErr } = await supabaseAdmin
      .from("user_stripe")
      .select("id")
      .eq("stripe_customer_id", stripeCustomerId);
    if (!pErr && (parents?.length ?? 0) > 0) {
      const ids = (parents ?? []).map((p: any) => p.id);
      const { data, error } = await supabaseAdmin
        .from("recipient_emails")
        .select("email, created_via, pending_removal")
        .in("user_stripe_id", ids);
      if (!error) {
        for (const row of data ?? []) {
          upsert(row?.email ?? null, row?.created_via ?? null, row?.pending_removal ?? null);
        }
      }
    }
  }

  if (ownerEmail) {
    const { data, error } = await supabaseAdmin
      .from("recipient_emails")
      .select("email, created_via, pending_removal")
      .eq("email", ownerEmail);
    if (!error) {
      for (const row of data ?? []) {
        upsert(row?.email ?? null, row?.created_via ?? null, row?.pending_removal ?? null);
      }
    }
  }

  if (ownerEmail) {
    upsert(ownerEmail, "initial", false);
  }

  return Array.from(collected.values()).map((entry) => ({
    ...entry,
    is_owner: normalizedOwner ? entry.email.toLowerCase() === normalizedOwner : entry.is_owner,
  }));
}

// Simple exponential backoff retry for Stripe 429s
async function safeStripeCall<T>(fn: () => Promise<T>, label: string, maxRetries = Number(process.env.STRIPE_MAX_429_RETRIES || 2)) {
  const baseDelay = Number(process.env.STRIPE_RETRY_BASE_DELAY_MS || 200);
  let attempt = 0;
  const retries = isFinite(maxRetries) ? Math.max(0, Math.min(5, maxRetries)) : 2;
  const base = isFinite(baseDelay) ? Math.max(50, Math.min(2000, baseDelay)) : 200;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.statusCode ?? err?.raw?.statusCode;
      const isRate = status === 429 || err?.code === "rate_limit" || err?.type === "StripeRateLimitError";
      if (isRate && attempt < retries) {
        const jitter = Math.floor(Math.random() * 50);
        const wait = base * Math.pow(2, attempt) + jitter;
        console.warn(`[stripe-backoff] ${label} 429 retry #${attempt + 1} in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        attempt++;
        continue;
      }
      throw err;
    }
  }
}
