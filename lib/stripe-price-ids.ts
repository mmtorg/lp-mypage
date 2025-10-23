function csv(name: string): string[] {
  const v = process.env[name];
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export function getLitePriceIds(): string[] {
  const combined = csv("STRIPE_PRICE_IDS_LITE");
  if (combined.length > 0) return combined;
  const monthly = process.env.STRIPE_PRICE_ID_LITE_MONTHLY || "";
  const yearly = process.env.STRIPE_PRICE_ID_LITE_YEARLY || "";
  return uniq([monthly, yearly].filter(Boolean));
}

export function getBusinessPriceIds(): string[] {
  const combined = csv("STRIPE_PRICE_IDS_BUSINESS");
  if (combined.length > 0) return combined;
  const monthly = process.env.STRIPE_PRICE_ID_BUSINESS_MONTHLY || "";
  const yearly = process.env.STRIPE_PRICE_ID_BUSINESS_YEARLY || "";
  return uniq([monthly, yearly].filter(Boolean));
}

/**
 * Add-on Price ID helpers
 */
export function getAddonPriceIdForPlan(
  plan: "lite" | "business",
  interval?: "month" | "year" | null
): string | undefined {
  // 追加購入は月額に統一（ベースが年額でも月額のアドオンを使用）
  if (plan === "business") {
    const m = process.env.STRIPE_ADDON_PRICE_ID_BUSINESS_MONTHLY;
    const legacy = process.env.STRIPE_ADDON_PRICE_ID_BUSINESS;
    return m || legacy || undefined;
  }
  const m = process.env.STRIPE_ADDON_PRICE_ID_LITE_MONTHLY;
  const legacy = process.env.STRIPE_ADDON_PRICE_ID_LITE;
  return m || legacy || undefined;
}

export function getAddonPriceIdForBasePriceId(
  basePriceId?: string,
  opts?: { interval?: "month" | "year" | null }
): string | undefined {
  const id = (basePriceId || "").trim();
  if (!id) return undefined;

  // Exact match against explicit split keys first
  const L_M = process.env.STRIPE_PRICE_ID_LITE_MONTHLY || "";
  const L_Y = process.env.STRIPE_PRICE_ID_LITE_YEARLY || "";
  const B_M = process.env.STRIPE_PRICE_ID_BUSINESS_MONTHLY || "";
  const B_Y = process.env.STRIPE_PRICE_ID_BUSINESS_YEARLY || "";

  if (id === L_M) return process.env.STRIPE_ADDON_PRICE_ID_LITE_MONTHLY || process.env.STRIPE_ADDON_PRICE_ID_LITE || undefined;
  if (id === L_Y) return process.env.STRIPE_ADDON_PRICE_ID_LITE_MONTHLY || process.env.STRIPE_ADDON_PRICE_ID_LITE || undefined;
  if (id === B_M) return process.env.STRIPE_ADDON_PRICE_ID_BUSINESS_MONTHLY || process.env.STRIPE_ADDON_PRICE_ID_BUSINESS || undefined;
  if (id === B_Y) return process.env.STRIPE_ADDON_PRICE_ID_BUSINESS_MONTHLY || process.env.STRIPE_ADDON_PRICE_ID_BUSINESS || undefined;

  // Fallback: if base price exists in grouped lists, decide by interval if provided
  const lite = new Set(getLitePriceIds());
  const bus = new Set(getBusinessPriceIds());
  const interval = (opts?.interval || "month") as "month" | "year";
  if (lite.has(id)) return getAddonPriceIdForPlan("lite", interval);
  if (bus.has(id)) return getAddonPriceIdForPlan("business", interval);
  return undefined;
}
