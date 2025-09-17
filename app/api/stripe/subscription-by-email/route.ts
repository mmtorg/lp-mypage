import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin, getUserIdByEmail } from "@/lib/supabase-admin";

type Plan = "lite" | "business" | null;

function envList(name: string): string[] {
  const v = process.env[name];
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Prefer Product ID mapping only (simplify management)
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
    // 1) Product ID mapping（優先）
    const p = item?.price?.product as any;
    const productId: string | undefined = typeof p === "string" ? p : p?.id;
    if (productId) {
      if (LITE_PRODUCT_IDS.includes(productId)) return "lite";
      if (BUSINESS_PRODUCT_IDS.includes(productId)) return "business";
    }
    // 2) 最終フォールバック: Product名のキーワード
    if (productId) {
      const product = await stripe.products.retrieve(productId);
      const name = (product.name || "").toLowerCase();
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

    // 0) キャッシュ（Supabase）を確認
    const ttlSec = Number(process.env.SUBSCRIPTION_CACHE_TTL_SECONDS || 600);
    const now = Date.now();
    const debug: any = debugMode ? { step: "start", email, ttlSec } : undefined;
    if (debugMode) {
      console.log("[sub-by-email] start", { email, ttlSec, force });
      console.log("[sub-by-email] mappings", {
        LITE_PRODUCT_IDS,
        BUSINESS_PRODUCT_IDS,
      });
    }
    try {
      const { data: cached } = await supabaseAdmin
        .from("user_stripe")
        .select("current_plan, email, updated_at, user_id, stripe_customer_id")
        .eq("email", email)
        .maybeSingle();
      if (debugMode) debug.cached = cached ?? null;
      if (!force && cached?.updated_at) {
        const ageMs = now - new Date(cached.updated_at as any).getTime();
        // negative cache禁止: current_plan が null の場合は再照会する
        if (ageMs <= ttlSec * 1000 && cached.current_plan) {
          if (debugMode) console.log("[sub-by-email] hit cache(non-null)", { ageMs, cached });
          // enrich: try to fetch product name and addon price even on cache hit (lightweight)
          let productName: string | undefined;
          let addon_unit_amount: number | undefined;
          let addon_currency: string | undefined;
          try {
            if (cached.stripe_customer_id) {
              const all = await safeStripeCall(
                () => stripe.subscriptions.list({ customer: cached.stripe_customer_id, status: "all", limit: 5 }),
                "subscriptions.list"
              );
              const chosen = all.data.find((s) => VALID_STATUSES.has(String(s.status).toLowerCase()));
              const item = (chosen as any)?.items?.data?.[0];
              const prodAny = item?.price?.product;
              const productId = typeof prodAny === "string" ? prodAny : prodAny?.id;
              if (productId) {
                const product = await safeStripeCall(() => stripe.products.retrieve(productId as string), "products.retrieve");
                productName = (product as any)?.name;
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
          return NextResponse.json({
            current_plan: cached.current_plan,
            email,
            product_name: productName,
            addon_unit_amount,
            addon_currency,
          });
        } else if (debugMode) {
          console.log("[sub-by-email] bypass cache (stale or null)", { ageMs, cachedPlan: cached.current_plan });
        }
      }
    } catch {}

    // 1) 顧客検索（メールベース）
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
      console.log("[sub-by-email] customers", customers.data.map((c) => ({ id: c.id, email: (c as any).email })));
      if (debug) debug.customers = customers.data.map((c) => ({ id: c.id, email: (c as any).email }));
    }
    if (!customers.data.length) {
      // Stripe上に顧客・契約が無い場合は user_stripe へは登録しない
      if (debugMode) console.log("[sub-by-email] no customers found for email");
      return NextResponse.json({ current_plan: null, email });
    }

    // 2) 有効なサブスクを持つ顧客を優先（なければ最新顧客）
    let currentPlan: Plan = null;
    let stripeCustomerIdForLink: string | undefined;
    let productName: string | undefined;
    let chosenPriceId: string | undefined;
    let chosenProductId: string | undefined;
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
      const chosen = all.data.find((s) => VALID_STATUSES.has(String(s.status).toLowerCase()));
      if (debugMode) console.log("[sub-by-email] chosen", { found: !!chosen, status: chosen?.status });
      if (chosen) {
        currentPlan = await inferPlanFromSubscription(chosen);
        try {
          const item = (chosen as any).items?.data?.[0];
          chosenPriceId = item?.price?.id;
          const prodAny = item?.price?.product;
          chosenProductId = typeof prodAny === "string" ? prodAny : prodAny?.id;
          if (chosenProductId) {
            const product = await safeStripeCall(
              () => stripe.products.retrieve(chosenProductId as string),
              "products.retrieve"
            );
            productName = (product as any)?.name;
          }
        } catch {}
        const custAny = (chosen as any).customer;
        stripeCustomerIdForLink = typeof custAny === "string" ? custAny : custAny?.id || c.id;
        if (debugMode)
          console.log("[sub-by-email] inferred plan", {
            sub: chosen.id,
            currentPlan,
            productName,
            chosenPriceId,
            chosenProductId,
          });
        break;
      }
    }

    // 3) プランが有効なら、Supabaseに受信先として本人メールを upsert
    // 3) Supabase側にキャッシュと受信者登録（必要に応じてユーザー作成）
    let uid = await getUserIdByEmail(email);
    if (!uid) {
      try {
        const created = await (supabaseAdmin as any).auth.admin.createUser({
          email,
          email_confirm: true,
        });
        uid = created?.data?.user?.id ?? null;
        if (debugMode) console.log("[sub-by-email] auto-created user", { uid });
      } catch (e) {
        console.error("Auto-create user failed:", e);
      }
    }
    if (uid) {
      const upsertRow: any = {
        user_id: uid,
        email,
        current_plan: currentPlan,
        updated_at: new Date().toISOString(),
      };
      if (stripeCustomerIdForLink) upsertRow.stripe_customer_id = stripeCustomerIdForLink;
      // 契約情報（有効なサブスク）が存在する場合のみ user_stripe に登録
      if (currentPlan) {
        await supabaseAdmin.from("user_stripe").upsert(upsertRow, { onConflict: "user_id" });
        await supabaseAdmin
          .from("recipient_emails")
          .upsert([{ user_id: uid, email, plan: currentPlan }], { onConflict: "email", ignoreDuplicates: true });
      }
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

    if (debugMode) console.log("[sub-by-email] done", { email, currentPlan, productName, addon_unit_amount, addon_currency });
    if (debugMode && debug) debug.valid_statuses = Array.from(VALID_STATUSES.values());
    return NextResponse.json(
      debugMode
        ? { current_plan: currentPlan, email, product_name: productName, addon_unit_amount, addon_currency, debug }
        : { current_plan: currentPlan, email, product_name: productName, addon_unit_amount, addon_currency }
    );
  } catch (e) {
    console.error("subscription-by-email error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

// Simple exponential backoff retry for Stripe 429s
async function safeStripeCall<T>(fn: () => Promise<T>, label: string, maxRetries = Number(process.env.STRIPE_MAX_429_RETRIES || 2)) {
  const baseDelay = Number(process.env.STRIPE_RETRY_BASE_DELAY_MS || 200);
  let attempt = 0;
  // Clamp values
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
        const wait = base * Math.pow(2, attempt) + jitter; // 200, 400, 800ms...
        console.warn(`[stripe-backoff] ${label} 429 retry #${attempt + 1} in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        attempt++;
        continue;
      }
      throw err;
    }
  }
}
