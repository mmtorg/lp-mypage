import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getLitePriceIds, getBusinessPriceIds } from "@/lib/stripe-price-ids";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs"; // Edge不可（署名検証にraw body必要）

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature") as string | null;
  const raw = await req.text();

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(
      raw,
      sig!,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "customer.updated": {
        // 仕様: recipient_emails は請求者メールと独立に管理するため、
        // Stripeのcustomer.email変更をローカルDBへ反映しない。
        try {
          const customer = event.data.object as any;
          const previousEmail =
            (event.data.previous_attributes?.email as string) || null;
          const newEmail = (customer?.email as string) || null;
          console.log(
            "[webhook] customer.updated received (no local email sync)",
            {
              customerId: customer?.id,
              previousEmail,
              newEmail,
            }
          );
        } catch {}
        break;
      }

      case "checkout.session.completed": {
        const session = event.data.object as any;
        const customerId: string | null = session.customer ?? null;
        const customerEmail: string | null =
          session.customer_details?.email ?? session.customer_email ?? null;
        const rawPlan = session.metadata?.plan;
        let normalizedPlan =
          rawPlan && ["lite", "business", "trial"].includes(String(rawPlan))
            ? (rawPlan as "lite" | "business" | "trial")
            : null;
        let is_trialing = false;
        console.log("[webhook] checkout.session.completed", {
          customerId,
          customerEmail,
        });

        // If metadata.plan is missing (e.g., Payment Link), infer plan from Product/Price mapping
        // and only persist when the created subscription is in a valid status.
        if (!normalizedPlan) {
          const VALID_STATUSES = new Set(
            (process.env.SUBSCRIPTION_VALID_STATUSES || "active,trialing")
              .split(",")
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean)
          );
          const LITE_PRICE_IDS = getLitePriceIds();
          const BUSINESS_PRICE_IDS = getBusinessPriceIds();

          const inferPlanFromPriceId = async (
            priceId?: string | null
          ): Promise<"lite" | "business" | "trial" | null> => {
            if (!priceId) return null;
            if (LITE_PRICE_IDS.includes(priceId)) return "lite";
            if (BUSINESS_PRICE_IDS.includes(priceId)) return "business";
            try {
              const price = await stripe.prices.retrieve(priceId, {
                expand: ["product"],
              });
              const product = price.product as any;
              const metadataType = (product as any)?.metadata?.type;
              if (metadataType === "trial") return "trial";
              const name = product?.name?.toLowerCase?.() || "";
              if (name.includes("lite")) return "lite";
              if (name.includes("business")) return "business";
            } catch (e) {
              console.warn(
                `[webhook] infer plan from price failed for priceId=${priceId}`,
                e
              );
            }
            return null;
          };

          try {
            // Prefer subscription detail from session when available to also check status
            const subId: string | undefined = session.subscription || undefined;
            if (subId) {
              const sub = await stripe.subscriptions.retrieve(subId);
              const status = String((sub as any)?.status || "").toLowerCase();
              is_trialing = status === "trialing";
              const item = (sub as any)?.items?.data?.[0];
              const priceId: string | undefined = item?.price?.id;
              const inferred = await inferPlanFromPriceId(priceId);
              if (inferred && VALID_STATUSES.has(status)) {
                normalizedPlan = inferred;
                console.log("[webhook] inferred plan from subscription", {
                  subId,
                  status,
                  priceId,
                  normalizedPlan,
                });
              } else {
                console.log(
                  "[webhook] skip persist from checkout: invalid or unknown status/plan",
                  { subId, status, inferred, priceId }
                );
              }

              // If this is a trial product via Payment Link, enforce one-time eligibility per email/customer.
              try {
                const isTrialProduct = await isTrialSubscription(sub as any);
                if (isTrialProduct) {
                  const alreadyHadTrial = await hasPriorTrialForCustomerOrEmail(
                    customerId,
                    customerEmail,
                    subId
                  );
                  if (alreadyHadTrial) {
                    console.warn(
                      "[webhook] duplicate trial detected at checkout; canceling subscription",
                      { subId, customerId, customerEmail }
                    );
                    try {
                      await stripe.subscriptions.update(subId, {
                        metadata: { canceled_reason: "duplicate_trial" },
                      });
                    } catch {}
                    await stripe.subscriptions.cancel(subId);
                    // Optional cleanup: delete orphan customer if no active/trialing subs left
                  }
                }
              } catch (e) {
                console.warn(
                  "[webhook] duplicate-trial check failed (checkout)",
                  e
                );
              }

              // === ADD: トライアル商品なら「期間末で自動解約」を予約（冪等） ===
              try {
                const trialLike = await isTrialSubscription(sub as any);
                if (trialLike) {
                  await ensureCancelAtPeriodEnd(sub.id);
                }
              } catch (e) {
                console.warn(
                  "[webhook] auto-cancel at period end scheduling (checkout) failed",
                  e
                );
              }
            } else if (session?.id) {
              // Fallback: try line items to guess plan (no status check possible here)
              // To honour "valid-only" policy, we do NOT persist if we cannot validate status.
              try {
                const items = await stripe.checkout.sessions.listLineItems(
                  session.id,
                  { limit: 1 }
                );
                const li = items?.data?.[0];
                const priceId: string | undefined = (li as any)?.price?.id;
                const inferred = await inferPlanFromPriceId(priceId);
                console.log(
                  "[webhook] inferred plan from line items (no persist without status)",
                  { priceId, inferred }
                );
              } catch (e) {
                console.warn(
                  "[webhook] plan inference from line items failed",
                  e
                );
              }
            }
          } catch (e) {
            console.warn("[webhook] plan inference from checkout failed", e);
          }
        }

        if (customerEmail) {
          // Collect additional recipient emails from Checkout custom_fields / metadata
          const collectEmailsFromSession = (s: any): string[] => {
            const emails: string[] = [];
            const isEmail = (str: string) => /.+@.+\..+/.test(str);

            // custom_fields (Dashboard or API) — text fields
            const fields: any[] = Array.isArray(s?.custom_fields)
              ? s.custom_fields
              : [];
            for (const f of fields) {
              const val = f?.text?.value ?? f?.value ?? "";
              if (!val) continue;
              // allow comma/space separated
              const parts = String(val)
                .split(/[,\s]+/)
                .map((p: string) => p.trim())
                .filter(Boolean);
              for (const p of parts) if (isEmail(p)) emails.push(p);
            }

            // metadata.additional_emails supports CSV or JSON array
            const meta = s?.metadata || {};
            const raw =
              meta.additional_emails || meta.recipients || meta.emails;
            if (raw) {
              try {
                const arr = Array.isArray(raw) ? raw : JSON.parse(raw);
                if (Array.isArray(arr)) {
                  for (const e of arr)
                    if (typeof e === "string" && isEmail(e))
                      emails.push(e.trim());
                }
              } catch {
                const parts = String(raw)
                  .split(/[,\s]+/)
                  .map((p) => p.trim())
                  .filter(Boolean);
                for (const p of parts) if (isEmail(p)) emails.push(p);
              }
            }

            // Limit to reasonable amount to avoid abuse
            const uniq = Array.from(new Set(emails)).slice(0, 20);
            return uniq;
          };

          // Ensure parent user_stripe row exists without relying on ON CONFLICT.
          const nowIso = new Date().toISOString();
          let parent: { id: number } | null = null;

          async function resolveOrCreateParent() {
            const subId: string | undefined =
              session?.subscription || undefined;
            const custId: string | undefined = customerId || undefined;

            const baseUpdate: Record<string, any> = {
              email: customerEmail,
              updated_at: nowIso,
            };
            if (normalizedPlan) baseUpdate.current_plan = normalizedPlan;

            // 1) Try by subscription_id first
            if (subId) {
              const found = await supabaseAdmin
                .from("user_stripe")
                .select("id")
                .eq("stripe_subscription_id", subId)
                .maybeSingle();
              if (!found.error && found.data?.id) {
                const upd = await supabaseAdmin
                  .from("user_stripe")
                  .update({ ...baseUpdate, stripe_customer_id: custId ?? null })
                  .eq("id", found.data.id)
                  .select("id")
                  .maybeSingle();
                return upd.data ?? found.data;
              }
            }

            // 2) Try by customer_id
            if (custId) {
              const found = await supabaseAdmin
                .from("user_stripe")
                .select("id, stripe_subscription_id")
                .eq("stripe_customer_id", custId)
                .order("updated_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (!found.error && found.data?.id) {
                // If we have a subscription id and it differs (or found has null), insert a new row
                if (subId && found.data.stripe_subscription_id !== subId) {
                  const insPayload: Record<string, any> = {
                    ...baseUpdate,
                    stripe_customer_id: custId,
                    stripe_subscription_id: subId,
                  };
                  const ins = await supabaseAdmin
                    .from("user_stripe")
                    .insert(insPayload)
                    .select("id")
                    .maybeSingle();
                  if (ins.error) {
                    // Race-safe fallback: if unique violation occurred, fetch the existing row by subscription_id
                    const code = (ins.error as any)?.code;
                    if (code === "23505" && subId) {
                      const existed = await supabaseAdmin
                        .from("user_stripe")
                        .select("id")
                        .eq("stripe_subscription_id", subId)
                        .maybeSingle();
                      if (!existed.error && existed.data?.id) {
                        return existed.data;
                      }
                    }
                    console.error(
                      "[webhook] insert user_stripe (by customer, new sub) failed",
                      ins.error
                    );
                  }
                  return ins.data ?? found.data;
                }
                // Otherwise, update metadata fields on the existing row only (do not change subscription linkage)
                const upd = await supabaseAdmin
                  .from("user_stripe")
                  .update({ ...baseUpdate, stripe_customer_id: custId ?? null })
                  .eq("id", found.data.id)
                  .select("id")
                  .maybeSingle();
                return upd.data ?? found.data;
              }
            }

            // 3) Insert new row (no customer match)
            const insPayload: Record<string, any> = { ...baseUpdate };
            if (custId) insPayload.stripe_customer_id = custId;
            if (subId) insPayload.stripe_subscription_id = subId;
            const ins = await supabaseAdmin
              .from("user_stripe")
              .insert(insPayload)
              .select("id")
              .maybeSingle();
            if (ins.error) {
              // Race-safe fallback: unique violation means someone else already inserted; fetch existing row.
              const code = (ins.error as any)?.code;
              if (code === "23505") {
                if (subId) {
                  const existedBySub = await supabaseAdmin
                    .from("user_stripe")
                    .select("id")
                    .eq("stripe_subscription_id", subId)
                    .maybeSingle();
                  if (!existedBySub.error && existedBySub.data?.id) {
                    return existedBySub.data;
                  }
                }
                if (custId) {
                  const existedByCust = await supabaseAdmin
                    .from("user_stripe")
                    .select("id")
                    .eq("stripe_customer_id", custId)
                    .order("updated_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();
                  if (!existedByCust.error && existedByCust.data?.id) {
                    return existedByCust.data;
                  }
                }
              }
              console.error("[webhook] insert user_stripe failed", ins.error);
            }
            return ins.data ?? null;
          }

          try {
            parent = await resolveOrCreateParent();
          } catch (e) {
            console.error("[webhook] resolveOrCreateParent error", e);
          }

          // 3) ニュース配信先: 本人 + 追加入力分（Checkoutのcustom_fields / metadata）
          const extra = collectEmailsFromSession(session);
          console.log("[webhook] collected extra recipient emails", extra);
          const allEmails = Array.from(new Set([customerEmail, ...extra]));
          // Decide created_via from Product metadata.type ('basic'|'add')
          let createdVia: "initial" | "addon" | undefined = undefined;
          const mapTypeToVia = (t?: any): "initial" | "addon" | null => {
            if (!t) return null;
            const s = String(t).toLowerCase();
            if (s === "basic" || s === "trial") return "initial";
            if (s === "add") return "addon";
            return null;
          };
          try {
            let price: any;
            if (session?.subscription) {
              const sub = await stripe.subscriptions.retrieve(
                session.subscription,
                { expand: ["items.data.price"] }
              );
              price = (sub as any)?.items?.data?.[0]?.price;
            } else if (session?.id) {
              const items = await stripe.checkout.sessions.listLineItems(
                session.id,
                { limit: 1, expand: ["data.price"] }
              );
              price = items?.data?.[0]?.price;
            }
            // Productのmetadataから created_via を推定（price.metadataはフォールバック扱い）
            if (price?.product) {
              try {
                const prodAny = price.product as any;
                const productId: string | undefined =
                  typeof prodAny === "string" ? prodAny : prodAny?.id;
                if (productId) {
                  const product = await stripe.products.retrieve(productId);
                  if (product?.metadata?.type)
                    createdVia =
                      mapTypeToVia(product.metadata.type) ?? undefined;
                }
              } catch {}
            }
          } catch (e) {
            console.warn(
              "[webhook] failed to determine created_via from price metadata",
              e
            );
          }
          if (parent?.id) {
            // 1) 契約者メール（customerEmail）は常に先に upsert する
            if (customerEmail) {
              const ownerRow: Record<string, any> = {
                email: customerEmail,
                user_stripe_id: parent.id,
              };
              if (normalizedPlan) ownerRow.plan = normalizedPlan;
              // `createdVia`が`addon`でない場合、または未定義の場合は`initial`として扱う
              if (createdVia) {
                ownerRow.created_via = createdVia;
              } else {
                ownerRow.created_via = "initial";
              }
              const { error: ownerErr } = await supabaseAdmin
                .from("recipient_emails")
                .upsert([ownerRow], {
                  onConflict: "user_stripe_id,email",
                  ignoreDuplicates: true,
                });
              if (ownerErr)
                console.error(
                  "recipient_emails upsert (owner) error",
                  ownerErr
                );
            }

            // 2) 追加入力のメールを後で upsert（custom_fields/metadata 由来）
            const targetEmails = extra; // 契約者は既に処理済み
            if (targetEmails.length > 0) {
              const rows = targetEmails.map((email) => {
                const row: Record<string, any> = {
                  email,
                  user_stripe_id: parent.id,
                };
                if (normalizedPlan) row.plan = normalizedPlan;
                if (createdVia) {
                  row.created_via = createdVia;
                }
                return row;
              });
              const { error: recipErr } = await supabaseAdmin
                .from("recipient_emails")
                .upsert(rows, {
                  onConflict: "user_stripe_id,email",
                  ignoreDuplicates: true,
                });
              if (recipErr)
                console.error(
                  "recipient_emails upsert (extras) error",
                  recipErr
                );
              console.log("[webhook] recipients upserted", {
                count: rows.length,
                parentId: parent.id,
                emails: targetEmails,
                createdVia,
              });
            }
          } else {
            console.warn("[webhook] skip recipients: parent not resolved", {
              customerId: customerId ?? null,
              subscription: session?.subscription ?? null,
              emails: allEmails,
            });
          }
          console.log("[webhook] linked customer", {
            customerId: customerId ?? null,
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as any;
        try {
          // 親を特定してから recipient を削除
          const { data: parent } = await supabaseAdmin
            .from("user_stripe")
            .select("id")
            .eq("stripe_subscription_id", sub.id)
            .maybeSingle();
          if (parent?.id) {
            await supabaseAdmin
              .from("recipient_emails")
              .delete()
              .eq("user_stripe_id", parent.id);
          }
          await supabaseAdmin
            .from("user_stripe")
            .delete()
            .eq("stripe_subscription_id", sub.id);
          console.log("[webhook] deleted records for canceled subscription", {
            subscription: sub.id,
          });
        } catch (e) {
          console.error(
            "[webhook] failed to delete records for canceled subscription",
            e
          );
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as any;
        const customerId: string = sub.customer;
        const status: string = sub.status; // active / trialing / canceled など
        const is_trialing = status === "trialing";
        const VALID_STATUSES = new Set(
          (process.env.SUBSCRIPTION_VALID_STATUSES || "active,trialing")
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
        );

        // プラン種別の推定（Price ID ベース）
        const LITE_PRICE_IDS = (process.env.STRIPE_PRICE_IDS_LITE || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const BUSINESS_PRICE_IDS = (process.env.STRIPE_PRICE_IDS_BUSINESS || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        let planType: "lite" | "business" | "trial" | null = null;
        try {
          const item = sub.items?.data?.[0];
          const priceId = item?.price?.id;
          console.log("[webhook] subscription item", {
            priceId: priceId,
            product:
              typeof item?.price?.product === "string"
                ? item?.price?.product
                : item?.price?.product?.id,
            status,
          });
          // 1) Price ID で判定（優先）
          if (priceId) {
            if (LITE_PRICE_IDS.includes(priceId)) planType = "lite";
            if (BUSINESS_PRICE_IDS.includes(priceId)) planType = "business";
          }
          // 2) 最終フォールバック: Product名
          if (!planType && item?.price?.product) {
            const prodAny = item?.price?.product as any;
            const productId: string | undefined =
              typeof prodAny === "string" ? prodAny : prodAny?.id;
            if (productId) {
              const product = await stripe.products.retrieve(productId);
              const metadataType = (product as any)?.metadata?.type;
              if (metadataType === "trial") {
                planType = "trial";
              } else {
                const name = (product.name || "").toLowerCase();
                if (name.includes("lite")) planType = "lite";
                if (name.includes("business")) planType = "business";
              }
            }
          }
        } catch (e) {
          console.warn("Failed to infer plan type", e);
        }

        // Fallbacks for trial products: allow STRIPE_TRIAL_PRICE_IDS / STRIPE_TRIAL_PRODUCT_IDS or metadata.plan
        try {
          if (!planType) {
            const trialLike = await isTrialSubscription(sub);
            if (trialLike) planType = "trial";
          }
        } catch {}
        if (!planType) {
          const m = (sub as any)?.metadata;
          const mp = typeof m?.plan === "string" ? m.plan.toLowerCase() : null;
          if (mp === "trial") planType = "trial";
        }

        // Enforce: one-time free trial per email/customer
        try {
          const isTrialProduct = await isTrialSubscription(sub);
          if (
            isTrialProduct &&
            event.type === "customer.subscription.created"
          ) {
            // Retrieve customer email (may be null)
            let ownerEmail: string | null = null;
            try {
              ownerEmail =
                ((await stripe.customers.retrieve(customerId)) as any)?.email ??
                null;
            } catch {}
            const alreadyHadTrial = await hasPriorTrialForCustomerOrEmail(
              customerId,
              ownerEmail,
              sub.id
            );
            if (alreadyHadTrial) {
              console.warn(
                "[webhook] duplicate trial detected; canceling subscription",
                { subscription: sub.id, customerId, ownerEmail }
              );
              try {
                await stripe.subscriptions.update(sub.id, {
                  metadata: { canceled_reason: "duplicate_trial" },
                });
              } catch {}
              await stripe.subscriptions.cancel(sub.id);
              // After cancel, continue to clean-up paths below as needed (no throw)
            }
          }
        } catch (e) {
          console.warn("[webhook] duplicate-trial check failed (sub.*)", e);
        }

        // === ADD: トライアル商品なら「期間末で自動解約」を予約（冪等） ===
        try {
          const trialLike = await isTrialSubscription(sub);
          if (trialLike) {
            await ensureCancelAtPeriodEnd(sub.id);
          }
        } catch (e) {
          console.warn(
            "[webhook] auto-cancel at period end scheduling (sub.*) failed",
            e
          );
        }

        // Note: trial end behavior (cancel if missing payment method) is managed on Stripe settings now.

        // Keep planType as product tier; use is_trialing flag for trial state

        const isValid = VALID_STATUSES.has(String(status).toLowerCase());
        if (isValid && planType) {
          // Ensure row exists without ON CONFLICT
          const ownerEmail =
            ((await stripe.customers.retrieve(customerId)) as any)?.email ??
            null;
          const nowIso = new Date().toISOString();
          let parent: { id: number } | null = null;

          // Try by subscription_id
          const bySub = await supabaseAdmin
            .from("user_stripe")
            .select("id")
            .eq("stripe_subscription_id", sub.id)
            .maybeSingle();
          if (!bySub.error && bySub.data?.id) {
            const upd = await supabaseAdmin
              .from("user_stripe")
              .update({
                email: ownerEmail,
                stripe_customer_id: customerId,
                current_plan: planType,
                updated_at: nowIso,
              })
              .eq("id", bySub.data.id)
              .select("id")
              .maybeSingle();
            parent = upd.data ?? bySub.data;
          } else {
            // Try by customer_id
            const byCust = await supabaseAdmin
              .from("user_stripe")
              .select("id, stripe_subscription_id")
              .eq("stripe_customer_id", customerId)
              .order("updated_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (!byCust.error && byCust.data?.id) {
              // If existing row has different subscription, create a new row instead of overwriting
              if (
                byCust.data.stripe_subscription_id &&
                byCust.data.stripe_subscription_id !== sub.id
              ) {
                const ins = await supabaseAdmin
                  .from("user_stripe")
                  .insert({
                    email: ownerEmail,
                    stripe_customer_id: customerId,
                    stripe_subscription_id: sub.id,
                    current_plan: planType,
                    updated_at: nowIso,
                  })
                  .select("id")
                  .maybeSingle();
                parent = ins.data ?? null;
                if (ins.error) {
                  const code = (ins.error as any)?.code;
                  if (code === "23505") {
                    // 競合時は既存行を取り直す
                    const existedBySub = await supabaseAdmin
                      .from("user_stripe")
                      .select("id")
                      .eq("stripe_subscription_id", sub.id)
                      .maybeSingle();
                    if (!existedBySub.error && existedBySub.data?.id) {
                      parent = existedBySub.data;
                    } else {
                      const existedByCust = await supabaseAdmin
                        .from("user_stripe")
                        .select("id")
                        .eq("stripe_customer_id", customerId)
                        .order("updated_at", { ascending: false })
                        .limit(1)
                        .maybeSingle();
                      if (!existedByCust.error && existedByCust.data?.id) {
                        parent = existedByCust.data;
                      }
                    }
                  } else {
                    console.error(
                      "[webhook] insert user_stripe (sub events, new sub for same customer) failed",
                      ins.error
                    );
                  }
                }
              } else {
                // Update metadata on the existing row; do not change linkage when it differs
                const upd = await supabaseAdmin
                  .from("user_stripe")
                  .update({
                    email: ownerEmail,
                    current_plan: planType,
                    updated_at: nowIso,
                  })
                  .eq("id", byCust.data.id)
                  .select("id")
                  .maybeSingle();
                parent = upd.data ?? byCust.data;
              }
            } else {
              const ins = await supabaseAdmin
                .from("user_stripe")
                .insert({
                  email: ownerEmail,
                  stripe_customer_id: customerId,
                  stripe_subscription_id: sub.id,
                  current_plan: planType,
                  updated_at: nowIso,
                })
                .select("id")
                .maybeSingle();
              parent = ins.data ?? null;
              if (ins.error) {
                const code = (ins.error as any)?.code;
                if (code === "23505") {
                  // 競合時は既存行を取り直す
                  const existedBySub = await supabaseAdmin
                    .from("user_stripe")
                    .select("id")
                    .eq("stripe_subscription_id", sub.id)
                    .maybeSingle();
                  if (!existedBySub.error && existedBySub.data?.id) {
                    parent = existedBySub.data;
                  } else {
                    const existedByCust = await supabaseAdmin
                      .from("user_stripe")
                      .select("id")
                      .eq("stripe_customer_id", customerId)
                      .order("updated_at", { ascending: false })
                      .limit(1)
                      .maybeSingle();
                    if (!existedByCust.error && existedByCust.data?.id) {
                      parent = existedByCust.data;
                    }
                  }
                } else {
                  console.error(
                    "[webhook] insert user_stripe (sub events) failed",
                    ins.error
                  );
                }
              }
            }
          }
          console.log("[webhook] updated plan", {
            customerId,
            status,
            planType,
            validStatus: true,
          });

          // Propagate plan snapshot to recipient_emails for this subscription
          try {
            if (parent?.id) {
              await supabaseAdmin
                .from("recipient_emails")
                .update({ plan: planType })
                .eq("user_stripe_id", parent.id);
            }
            // Ensure purchaser email row exists with the latest plan snapshot
            const ownerEmail = (
              (await stripe.customers.retrieve(customerId)) as any
            )?.email as string | undefined;
            if (ownerEmail && parent?.id) {
              // Set created_via from Price metadata.type when known (fallback to Product)
              let createdVia: "initial" | "addon" | undefined = undefined;
              try {
                const item = (sub as any)?.items?.data?.[0];
                const prodAny = item?.price?.product as any;
                const productId: string | undefined =
                  typeof prodAny === "string" ? prodAny : prodAny?.id;
                const priceAny: any = item?.price;
                const pmt = String(
                  priceAny?.metadata?.type || ""
                ).toLowerCase();
                if (pmt === "basic" || pmt === "trial") createdVia = "initial";
                else if (pmt === "add" || pmt === "addon") createdVia = "addon";
                else if (productId) {
                  const product = await stripe.products.retrieve(productId);
                  const t = (product as any)?.metadata?.type;
                  const s = t ? String(t).toLowerCase() : "";
                  if (s === "basic" || s === "trial") createdVia = "initial";
                  if (s === "add" || s === "addon") createdVia = "addon";
                }
              } catch {}

              // addon 購入の場合は契約者メールの user_stripe_id を上書きしない
              if (createdVia !== "addon") {
                const upsertRow: Record<string, any> = {
                  email: ownerEmail,
                  plan: planType,
                };
                if (createdVia !== undefined)
                  upsertRow.created_via = createdVia;
                if (parent?.id) (upsertRow as any).user_stripe_id = parent.id;
                await supabaseAdmin
                  .from("recipient_emails")
                  .upsert([upsertRow], {
                    onConflict: "user_stripe_id,email",
                    ignoreDuplicates: true,
                  });
              }
            } else if (ownerEmail && !parent?.id) {
              console.warn(
                "[webhook] skip owner recipient upsert: parent not resolved",
                { customerId, subscription: sub.id }
              );
            }
          } catch (e) {
            console.warn("[webhook] failed to propagate plan to recipients", e);
          }
        } else {
          console.log("[webhook] ignore plan update (invalid status)", {
            customerId,
            status,
            planType,
            validStatus: false,
          });
        }
        try {
          await removePendingRecipients(customerId);
        } catch (e) {
          console.error("[webhook] failed to clear pending recipients", e);
        }

        break;
      }

      default:
        console.log(`Unhandled event: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error("Webhook handler error:", err);
    return new NextResponse("Server error", { status: 500 });
  }
}

async function removePendingRecipients(customerId: string) {
  if (!customerId) return;

  try {
    const { data: parents, error: pErr } = await supabaseAdmin
      .from("user_stripe")
      .select("id")
      .eq("stripe_customer_id", customerId);
    if (pErr) throw pErr;
    const idsParent = (parents ?? []).map((p: any) => p.id);
    if (!idsParent.length) return;
    const { data, error } = await supabaseAdmin
      .from("recipient_emails")
      .select("id")
      .in("user_stripe_id", idsParent)
      .eq("pending_removal", true);
    if (error) throw error;
    const ids = (data ?? [])
      .map((r: any) => r.id)
      .filter((v: any) => typeof v === "number");
    if (!ids.length) return;
    await supabaseAdmin.from("recipient_emails").delete().in("id", ids);
    console.log("[webhook] removed pending recipients", {
      customerId,
      removed: ids.length,
    });
  } catch (err) {
    console.error("[webhook] failed to remove pending recipients", err);
  }
}

// --- Helpers ---
async function isTrialSubscription(sub: any): Promise<boolean> {
  // price.metadata.type === 'trial' または price.id が ENV に含まれる場合を最優先
  const TRIAL_PRICES = new Set(
    String(process.env.STRIPE_TRIAL_PRICE_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const TRIAL_PRODUCTS = new Set(
    String(process.env.STRIPE_TRIAL_PRODUCT_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  try {
    const item = sub?.items?.data?.[0];
    const price: any = item?.price ?? {};
    const priceId: string | undefined = price?.id;
    const pmt = String(price?.metadata?.type || "").toLowerCase();
    if (pmt === "trial") return true;
    if (priceId && TRIAL_PRICES.has(priceId)) return true;
    const prodAny = price?.product as any;
    const productId: string | undefined =
      typeof prodAny === "string" ? prodAny : prodAny?.id;
    if (productId && TRIAL_PRODUCTS.has(productId)) return true;
  } catch {}
  return false;
}

// --- Auto-cancel helper (ADD) ---
async function ensureCancelAtPeriodEnd(subId: string) {
  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    // trial 中のみ対象。cancel_at（固定解約）が既に入っている場合は触らない。
    if (!sub || sub.status !== "trialing") return;
    const hasFixedCancelAt = Boolean(sub.cancel_at);
    const alreadyAtPeriodEnd = Boolean(sub.cancel_at_period_end);
    if (hasFixedCancelAt || alreadyAtPeriodEnd) {
      console.log("[webhook] auto-cancel already set", {
        subscription: sub.id,
        cancel_at: sub.cancel_at,
        cancel_at_period_end: sub.cancel_at_period_end,
      });
      return;
    }
    await stripe.subscriptions.update(sub.id, {
      cancel_at_period_end: true, // ← 「現在の期間末」で解約（トライアル延長/短縮にも追従）
    });
    console.log("[webhook] scheduled auto-cancel at period end", {
      subscription: sub.id,
    });
  } catch (e) {
    console.warn("[webhook] ensureCancelAtPeriodEnd failed", { subId, e });
  }
}

async function hasPriorTrialForCustomerOrEmail(
  customerId: string | null,
  email: string | null,
  excludeSubId?: string
): Promise<boolean> {
  // 1) Check the given customer first
  try {
    if (customerId) {
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
      });
      for (const s of subs.data) {
        if (excludeSubId && s.id === excludeSubId) continue;
        const trial = await isTrialSubscription(s as any);
        if (trial) return true;
      }
    }
  } catch (e) {
    console.warn("[webhook] hasPriorTrial: customer scan failed", e);
  }

  // 2) Optional: scan other customers by the same email (lifetime constraint per email)
  try {
    if (email) {
      // Avoid unsupported -id filter on new API versions; filter in app
      const found = await (stripe.customers as any).search?.({
        query: `email:"${email}"`,
        limit: 20,
      });
      const list = found && Array.isArray(found.data) ? found.data : [];
      for (const c of list) {
        if (customerId && c.id === customerId) continue;
        const subs = await stripe.subscriptions.list({
          customer: c.id,
          status: "all",
          limit: 100,
        });
        for (const s of subs.data) {
          const trial = await isTrialSubscription(s as any);
          if (trial) return true;
        }
      }
    }
  } catch (e) {
    console.warn("[webhook] hasPriorTrial: email scan failed", e);
  }

  return false;
}
