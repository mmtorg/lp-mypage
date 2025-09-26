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
        const customer = event.data.object as any;
        const previousEmail = (
          event.data.previous_attributes?.email as string
        )?.trim();
        const newEmail = (customer.email as string)?.trim();
        const customerId = customer.id;

        console.log("[webhook] customer.updated received", {
          customerId,
          newEmail,
          previousEmail,
        });

        if (!previousEmail || !newEmail || !customerId || previousEmail === newEmail) {
          console.log(
            "[webhook] customer.updated skipped (no change or missing data)"
          );
          break;
        }

        try {
          // 1. Update user_stripe table
          const { error: userStripeError, count: userStripeCount } = await supabaseAdmin
            .from("user_stripe")
            .update({ email: newEmail, updated_at: new Date().toISOString() })
            .eq("stripe_customer_id", customerId)
            .select();

          console.log(
            "[webhook] customer.updated: user_stripe update attempted",
            { customerId, count: userStripeCount }
          );
          if (userStripeError) {
            throw new Error(
              `user_stripe update failed: ${userStripeError.message}`
            );
          }

          // 2. Update recipient_emails table for the owner
          const { data: userStripeRecords, error: findError } = await supabaseAdmin
            .from("user_stripe")
            .select("id")
            .eq("stripe_customer_id", customerId);

          if (findError) {
            throw new Error(
              `Failed to find user_stripe records: ${findError.message}`
            );
          }

          if (userStripeRecords && userStripeRecords.length > 0) {
            const userStripeIds = userStripeRecords.map((r) => r.id);
            console.log("[webhook] customer.updated: found user_stripe IDs", {
              userStripeIds,
            });

            const { error: recipientEmailError, count: recipientEmailCount } =
              await supabaseAdmin
                .from("recipient_emails")
                .update({ email: newEmail })
                .in("user_stripe_id", userStripeIds)
                .eq("email", previousEmail) // Use previousEmail to find the record
                .select();

            console.log(
              "[webhook] customer.updated: recipient_emails update attempted",
              { count: recipientEmailCount }
            );
            if (recipientEmailError) {
              throw new Error(
                `recipient_emails update failed: ${recipientEmailError.message}`
              );
            }
          } else {
            console.warn(
              "[webhook] customer.updated: no user_stripe records found for customerId when updating recipients",
              customerId
            );
          }

          console.log("[webhook] customer.updated successful sync", {
            customerId,
          });
        } catch (e) {
          console.error("[webhook] customer.updated sync failed", e);
        }
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

        // If metadata.plan is missing (e.g., Payment Link), infer plan from Product ID mapping
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
              const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
              const product = price.product as any;
              const metadataType = (product as any)?.metadata?.type;
              if (metadataType === 'trial') return 'trial';
              const name = product?.name?.toLowerCase?.() || "";
              if (name.includes("lite")) return "lite";
              if (name.includes("business")) return "business";
            } catch {}
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
                  { subId, status, inferred }
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
              } catch {}
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
            if (price?.metadata?.type) {
              createdVia = mapTypeToVia(price.metadata.type) ?? undefined;
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
                .upsert([ownerRow], { onConflict: "email", ignoreDuplicates: true });
              if (ownerErr)
                console.error("recipient_emails upsert (owner) error", ownerErr);
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
                .upsert(rows, { onConflict: "email", ignoreDuplicates: true });
              if (recipErr)
                console.error("recipient_emails upsert (extras) error", recipErr);
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
        const BUSINESS_PRICE_IDS = (
          process.env.STRIPE_PRICE_IDS_BUSINESS || ""
        )
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
              if (metadataType === 'trial') {
                planType = 'trial';
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
              if (ins.error)
                console.error(
                  "[webhook] insert user_stripe (sub events, new sub for same customer) failed",
                  ins.error
                );
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
            if (ins.error)
              console.error(
                "[webhook] insert user_stripe (sub events) failed",
                ins.error
              );
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
            if (ownerEmail) {
              // Set created_via from Product metadata.type when known
              let createdVia: "initial" | "addon" | undefined = undefined;
              try {
                const item = (sub as any)?.items?.data?.[0];
                const prodAny = item?.price?.product as any;
                const productId: string | undefined =
                  typeof prodAny === "string" ? prodAny : prodAny?.id;
                if (productId) {
                  const product = await stripe.products.retrieve(productId);
                  const t = (product as any)?.metadata?.type;
                  const s = t ? String(t).toLowerCase() : "";
                  if (s === "basic") createdVia = "initial";
                  if (s === "add") createdVia = "addon";
                }
              } catch {}

              // addon 購入の場合は契約者メールの user_stripe_id を上書きしない
              if (createdVia !== "addon") {
                const upsertRow: Record<string, any> = {
                  email: ownerEmail,
                  plan: planType,
                };
                if (createdVia !== undefined) upsertRow.created_via = createdVia;
                if (parent?.id) (upsertRow as any).user_stripe_id = parent.id;
                await supabaseAdmin
                  .from("recipient_emails")
                  .upsert([upsertRow], {
                    onConflict: "email",
                    ignoreDuplicates: true,
                  });
              }
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
