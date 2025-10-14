// app/api/trial/request/route.ts
import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = 'force-dynamic';
export const runtime = "nodejs";

// Lightweight debug: identify which code is actually running
const HANDLER_VERSION = "trial-request/v2.0.0";
console.log(`[trial] handler loaded: ${HANDLER_VERSION}`);

// --- In‑process email lock to serialize requests per email (dev/runtime=nodejs) ---
const emailLocks = new Map<string, Promise<void>>();
async function acquireEmailLock(key: string): Promise<() => void> {
  const norm = key.trim().toLowerCase();
  const prev = emailLocks.get(norm) || Promise.resolve();
  let release!: () => void;
  const current = prev.then(() => new Promise<void>((r) => (release = r)));
  emailLocks.set(norm, current);
  await prev; // wait previous holder
  return () => {
    try {
      release();
    } finally {
      if (emailLocks.get(norm) === current) emailLocks.delete(norm);
    }
  };
}

function parseCsvEnv(name: string): string[] {
  return String(process.env[name] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isEmail(value: string): boolean {
  return /.+@.+\..+/.test(value);
}

async function getOrCreateCustomerByEmail(email: string) {
  const normalized = email.trim().toLowerCase();

  const searchAndFilter = async (searchFn: () => Promise<any[]>) => {
    try {
      const customers = await searchFn();
      // @ts-ignore
      const activeCustomer = customers.find(c => !c.deleted);
      if (activeCustomer) {
        return activeCustomer;
      }
    } catch {} // Ignore errors during search
    return null;
  };

  // Use stripe.customers.list to find the customer by email.
  // This is more reliable than the search API which can have indexing delays.
  let customer = await searchAndFilter(async () => {
    const listed = await stripe.customers.list({ email: normalized, limit: 20 });
    return (listed?.data || []) as any[];
  });

  if (customer) {
    try {
      // Verify the customer exists and is not deleted.
      const verifiedCustomer = await stripe.customers.retrieve(customer.id);
      // @ts-ignore
      if (verifiedCustomer && !verifiedCustomer.deleted) {
        return verifiedCustomer;
      }
    } catch (e) {
      // If retrieve fails, the customer ID is invalid. Proceed to create a new one.
      console.warn(`Customer ${customer.id} for ${email} found but failed to retrieve. Will create a new one.`, e);
    }
  }

  // Create with idempotency and verify to avoid stale cache issues
  try {
    const baseIdemKey = `trial-customer:${normalized}`;
    let createdCustomer = await stripe.customers.create(
      { email: normalized },
      { idempotencyKey: baseIdemKey }
    );

    // Verify the created customer to bust idempotency cache
    try {
      await stripe.customers.retrieve(createdCustomer.id);
    } catch (e: any) {
      // If retrieve fails, it's likely a stale ID from idempotency cache.
      // Retry with a unique key.
      if (e?.code === 'resource_missing') {
        const retryIdemKey = `${baseIdemKey}:${Date.now()}`;
        createdCustomer = await stripe.customers.create(
          { email: normalized },
          { idempotencyKey: retryIdemKey }
        );
      } else {
        // For any other error, re-throw to halt the process.
        throw e;
      }
    }
    return createdCustomer;

  } catch (e) {
    // If creation fails for other reasons, re-throw
    console.error(`Customer creation failed for ${email}`, e);
    throw e;
  }
}

async function resolveTrialPriceId(productId: string): Promise<string | null> {
  try {
    const product = await stripe.products.retrieve(productId, {
      expand: ["default_price"],
    });
    const def: any = (product as any).default_price ?? null;
    if (def && typeof def === "object" && def.id) return def.id as string;
  } catch {} // Ignore errors during product retrieval
  try {
    const prices = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 10,
    });
    const first = prices.data.find((p) => Boolean(p.id));
    return first?.id ?? null;
  } catch {} // Ignore errors during price listing
  return null;
}

async function listCustomersByEmail(email: string) {
  try {
    const res = await stripe.customers.list({ email, limit: 20 });
    return res.data || [];
  } catch { // Ignore errors during customer listing
    return [];
  }
}

function trialProductSet() {
  return new Set(
    String(process.env.STRIPE_TRIAL_PRODUCT_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

async function isTrialSubscription(sub: any): Promise<boolean> {
  const TRIALS = trialProductSet();
  if (TRIALS.size === 0) return false;
  try {
    const item = sub?.items?.data?.[0];
    const prodAny = item?.price?.product as any;
    const productId: string | undefined =
      typeof prodAny === "string" ? prodAny : prodAny?.id;
    if (!productId) return false;
    return TRIALS.has(productId);
  } catch { // Ignore errors during subscription item processing
    return false;
  }
}

function isLikelyStaleSubscription(sub: any, expectedCustomerId: string): boolean {
  try {
    if (!sub || typeof sub !== "object") return true;
    const cust = (sub as any)?.customer;
    if (cust && cust !== expectedCustomerId) return true;
    const created = Number((sub as any)?.created || 0);
    if (Number.isFinite(created)) {
      const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - created);
      if (ageSec > 10 * 60) return true; // 10分より古い応答は再生とみなす
    }
    const status = String((sub as any)?.status || "").toLowerCase();
    if (status && status !== "trialing") return true;
  } catch {} // Ignore errors during stale check
  return false;
}

type TrialCheckResult = {
  status: "none" | "trialing" | "ended";
};

async function checkTrialStatusByEmail(email: string): Promise<TrialCheckResult> {
  try {
    const customers = await listCustomersByEmail(email);
    let foundAny = false;
    for (const c of customers) {
      const subs = await stripe.subscriptions.list({
        customer: c.id,
        status: "all",
        limit: 100,
      });
      for (const s of subs.data) {
        if (await isTrialSubscription(s as any)) {
          foundAny = true;
          if (s.status === "trialing") {
            return { status: "trialing" };
          }
        }
      }
    }
    if (foundAny) return { status: "ended" };
  } catch {} // Ignore errors during trial status check
  return { status: "none" };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const email = String(body?.email || "").trim();
    if (!isEmail(email)) {
      return NextResponse.json({ ok: false, error: "invalid email" }, { status: 400 });
    }

    const TRIAL_PRODUCTS = parseCsvEnv("STRIPE_TRIAL_PRODUCT_IDS");
    if (TRIAL_PRODUCTS.length === 0) {
      return NextResponse.json(
        { ok: false, error: "trial products not configured" },
        { status: 500 }
      );
    }
    const TRIAL_DAYS = Math.max(
      1,
      Math.min(90, Number(process.env.TRIAL_PERIOD_DAYS || 30))
    );

    // 事前に同一メールでの既存トライアル状態をチェック（UXのため）
    try {
      const prior = await checkTrialStatusByEmail(email);
      if (prior.status === "trialing") {
        return NextResponse.json({ ok: true, already: true, reason: "current" });
      }
      if (prior.status === "ended") {
        return NextResponse.json({ ok: true, already: true, reason: "ended" });
      }
    } catch {} // Ignore errors during prior trial check

    // 0) 同一メールの並列実行を防止（簡易ロック）
    const unlock = await acquireEmailLock(email);
    try {
      // 1) Stripe顧客をメールアドレスで検索、なければ作成
      let customer = await getOrCreateCustomerByEmail(email);

      // ここでcustomerがnullやundefinedだと致命的なのでチェック
      if (!customer || !customer.id) {
        console.error("Failed to get or create a valid customer for email:", email);
        return NextResponse.json(
            { ok: false, error: "Could not resolve customer" },
            { status: 500 }
        );
      }

    // 1.5) 直前での実在検証ガード（もし同時並行やキャッシュで古いIDが紛れ込んだ場合に備える）
    try {
      const verified = await stripe.customers.retrieve(customer.id);
      // @ts-ignore
      if (!verified || (verified as any).deleted) {
        throw new Error("customer deleted or not found");
      }
    } catch (e: any) {
      console.warn(`[trial] re-verify failed for customer ${customer.id}. Creating a fresh one.`, e?.message || e);
      const retryIdemKey = `trial-customer:force:${email.trim().toLowerCase()}:${Date.now()}`;
      customer = await stripe.customers.create(
        { email: email.trim().toLowerCase() },
        { idempotencyKey: retryIdemKey }
      );
    }

    // 2) 1つ目のトライアル商品からPriceを解決（ID配列に複数ある場合は先頭を使用）
    const productId = TRIAL_PRODUCTS[0];
    const priceId = await resolveTrialPriceId(productId);
    if (!priceId) {
      return NextResponse.json(
        { error: "trial price not found for product" },
        { status: 400 }
      );
    }

    // 3) 無料トライアル開始（支払い手段不要）
    //    - trial_period_days を設定
    //    - 決済手段未登録でも "trialing" で開始される
    const normalizedEmail = email.trim().toLowerCase();
    const buildSubIdemKey = (
      custId: string,
      prodId: string,
      price: string,
      days: number
    ) => `trial-subscription:v1:${normalizedEmail}:${custId}:${prodId}:${price}:${days}`;

    const baseKey = buildSubIdemKey(customer.id, productId, priceId, TRIAL_DAYS);
    let sub: any;
    try {
      sub = await stripe.subscriptions.create(
        {
          customer: customer.id,
          items: [{ price: priceId }],
          trial_period_days: TRIAL_DAYS,
          metadata: { plan: "trial", initiated_via: "api" },
        },
        { idempotencyKey: baseKey }
      );
    } catch (e: any) {
      // idempotency mismatch（以前と異なるパラメータで同じキーを使った）時は新キーで再試行
      const isIdemErr = e?.raw?.type === "idempotency_error" || e?.type === "StripeIdempotencyError";
      if (!isIdemErr) throw e;
      const retryKey = `${baseKey}:retry:${Date.now()}`;
      sub = await stripe.subscriptions.create(
        {
          customer: customer.id,
          items: [{ price: priceId }],
          trial_period_days: TRIAL_DAYS,
          metadata: { plan: "trial", initiated_via: "api" },
        },
        { idempotencyKey: retryKey }
      );
    }
    // 作成結果の実在確認→古い応答と判断できる場合は新キーで再作成
    try {
      const got = await stripe.subscriptions.retrieve((sub as any).id);
      if (isLikelyStaleSubscription(got, (customer as any).id)) {
        sub = await stripe.subscriptions.create(
          {
            customer: (customer as any).id,
            items: [{ price: priceId }],
            trial_period_days: TRIAL_DAYS,
            metadata: { plan: "trial", initiated_via: "api:retry" },
          },
          { idempotencyKey: `trial-subscription:${email.trim().toLowerCase()}:${productId}:${Date.now()}` }
        );
      }
    } catch { // Ignore errors during stale check or re-creation
      // 取得失敗（おそらく削除済みIDの再生）。一度だけ新キーで再発行
      sub = await stripe.subscriptions.create(
        {
          customer: (customer as any).id,
          items: [{ price: priceId }],
          trial_period_days: TRIAL_DAYS,
          metadata: { plan: "trial", initiated_via: "api:retry" },
        },
        { idempotencyKey: `trial-subscription:${email.trim().toLowerCase()}:${productId}:${Date.now()}` }
      );
    }

      // 4) DB 連携は Stripe Webhook (customer.subscription.created/updated) に委譲
      //    既存ロジックにより user_stripe / recipient_emails が作成・更新されます。

      const res = NextResponse.json({
        ok: true,
        already: false,
        subscriptionId: sub.id,
        status: sub.status,
        customerId: customer.id,
        handlerVersion: HANDLER_VERSION,
      });
      res.headers.set("x-trial-handler-version", HANDLER_VERSION);
      res.headers.set("x-trial-customer-id", customer.id);
      return res;
    } finally {
      unlock();
    }
  } catch (e: any) {
    console.error("/api/trial/request error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "failed" },
      { status: 500 }
    );
  }
}

// GET ハンドラは /trial/start 経由のPOST運用に一本化したため削除しました。
