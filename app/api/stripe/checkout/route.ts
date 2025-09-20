import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type Plan = "lite" | "business";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      plan: Plan;
      quantity: number;
      ownerEmail?: string;
      additionalEmails?: string[];
    };

    const plan = body?.plan;
    // Normalize quantity to a safe integer within bounds
    const quantity = Math.min(10, Math.max(1, Math.floor(Number(body?.quantity))));
    const ownerEmail = (body?.ownerEmail || "").trim() || undefined;

    if (plan !== "lite" && plan !== "business") {
      return NextResponse.json({ error: "invalid plan" }, { status: 400 });
    }
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 10) {
      return NextResponse.json({ error: "invalid quantity" }, { status: 400 });
    }

    const priceId =
      (plan === "lite" && process.env.STRIPE_ADDON_PRICE_ID_LITE) ||
      (plan === "business" && process.env.STRIPE_ADDON_PRICE_ID_BUSINESS) ||
      undefined;
    if (!priceId) {
      return NextResponse.json({ error: "missing price id" }, { status: 500 });
    }

    // Determine session mode based on price type
    const price = await stripe.prices.retrieve(priceId);
    const mode: "payment" | "subscription" =
      (price as any)?.type === "recurring" ? "subscription" : "payment";

    const origin = req.nextUrl.origin;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || origin;
    const success_url = `${baseUrl}/mypage?success=1`;
    const cancel_url = `${baseUrl}/mypage?canceled=1`;

    let stripeCustomerId: string | undefined;
    if (ownerEmail) {
      try {
        const { data } = await supabaseAdmin
          .from("user_stripe")
          .select("stripe_customer_id, updated_at")
          .eq("email", ownerEmail)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        stripeCustomerId = (data as any)?.stripe_customer_id ?? undefined;
      } catch (err) {
        console.warn("Failed to resolve stripe_customer_id for checkout", err);
      }
    }

    const metadata: Record<string, string> = { plan };
    if (ownerEmail) metadata.owner_email = ownerEmail;
    const additionalEmails = Array.isArray(body?.additionalEmails)
      ? body.additionalEmails.filter((e) => typeof e === "string" && /.+@.+\..+/.test(e.trim())).map((e) => e.trim())
      : undefined;
    if (additionalEmails && additionalEmails.length > 0) {
      // Provide as JSON string so webhook can read from metadata.additional_emails
      metadata.additional_emails = JSON.stringify(additionalEmails.slice(0, 20));
    }

    let sessionUrl: string | undefined;

    // If customer is known, try to UPDATE existing add-on quantity
    // (independent of the configured price's type)
    if (stripeCustomerId) {
      try {
        const subs = await stripe.subscriptions.list({
          customer: stripeCustomerId,
          status: "all",
          limit: 20,
        });
        const VALID = new Set(
          (process.env.SUBSCRIPTION_VALID_STATUSES || "active,trialing")
            .split(",")
            .map((v) => v.trim().toLowerCase())
            .filter(Boolean)
        );

        // Find a subscription that ALREADY has this add-on price
        // Find a subscription that already contains an add-on item.
        // Priority: Product ID match from env (per plan) > exact Price ID match > product.metadata.type==='add'
        const ADDON_PRODUCT_IDS = new Set(
          ((plan === "lite"
            ? process.env.STRIPE_ADDON_PRODUCT_IDS_LITE
            : process.env.STRIPE_ADDON_PRODUCT_IDS_BUSINESS) || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        );
        let targetSub: any | undefined;
        let addonItem: any | undefined;
        for (const s of subs.data as any[]) {
          if (!VALID.has(String(s.status).toLowerCase())) continue;
          const items = Array.isArray(s.items?.data) ? s.items.data : [];
          // 1) Product ID match by env list (fast path when product id is present)
          for (const it of items) {
            const prodAny = it?.price?.product as any;
            const productId: string | undefined = typeof prodAny === "string" ? prodAny : prodAny?.id;
            if (productId && ADDON_PRODUCT_IDS.has(productId)) {
              addonItem = it;
              targetSub = s;
              break;
            }
          }
          if (targetSub && addonItem) break;
          // 2) Try by exact price id match
          addonItem = items.find((it: any) => it?.price?.id === priceId);
          if (addonItem) {
            targetSub = s;
            break;
          }
          // 3) Fallback: try to detect by product metadata.type === 'add'
          for (const it of items) {
            try {
              const p = it?.price?.product as any;
              const productId: string | undefined = typeof p === "string" ? p : p?.id;
              if (!productId) continue;
              const product = await stripe.products.retrieve(productId);
              const t = (product as any)?.metadata?.type;
              if (t && String(t).toLowerCase() === "add") {
                addonItem = it;
                targetSub = s;
                break;
              }
            } catch {}
          }
          if (targetSub && addonItem) break;
        }

        if (targetSub && addonItem) {
          const currentQty =
            typeof addonItem.quantity === "number" && !Number.isNaN(addonItem.quantity)
              ? addonItem.quantity
              : 0;
          const newQty = currentQty + quantity;

          // Update the existing subscription item quantity directly via API
          await stripe.subscriptionItems.update(addonItem.id, {
            quantity: newQty,
            proration_behavior: "create_prorations",
          } as any);

          // Persist recipients immediately (no Checkout session will fire a webhook)
          try {
            // Resolve or create user_stripe row for this subscription
            const nowIso = new Date().toISOString();
            let userStripeId: number | undefined;
            const found = await supabaseAdmin
              .from("user_stripe")
              .select("id")
              .eq("stripe_subscription_id", targetSub.id)
              .maybeSingle();
            if (found.data?.id) {
              userStripeId = found.data.id as number;
              await supabaseAdmin
                .from("user_stripe")
                .update({ updated_at: nowIso, current_plan: plan })
                .eq("id", userStripeId);
            } else {
              const ins = await supabaseAdmin
                .from("user_stripe")
                .insert({
                  email: ownerEmail || null,
                  stripe_customer_id: stripeCustomerId,
                  stripe_subscription_id: targetSub.id,
                  current_plan: plan,
                  updated_at: nowIso,
                })
                .select("id")
                .maybeSingle();
              if (ins.data?.id) userStripeId = ins.data.id as number;
            }

            if (userStripeId && additionalEmails && additionalEmails.length > 0) {
              const rows = additionalEmails.map((em) => ({
                email: em,
                user_stripe_id: userStripeId!,
                plan,
                pending_removal: false,
                created_via: "addon" as const,
              }));
              const { error: recErr } = await supabaseAdmin
                .from("recipient_emails")
                .upsert(rows, { onConflict: "email" });
              if (recErr) console.warn("[checkout] recipients upsert after update failed", recErr);
            }
          } catch (persistErr) {
            console.warn("[checkout] post-update persistence failed", persistErr);
          }

          // Resolve product name for UI feedback
          let productName: string | undefined;
          try {
            const prodAny = (addonItem as any)?.price?.product as any;
            const productId: string | undefined = typeof prodAny === "string" ? prodAny : prodAny?.id;
            if (productId) {
              const product = await stripe.products.retrieve(productId);
              productName = (product as any)?.name || undefined;
            }
          } catch {}

          // Create Billing Portal session
          const portal = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: `${baseUrl}/mypage?updated=1`,
          });

          return NextResponse.json({
            updated: true,
            portalUrl: (portal as any)?.url,
            productName: productName,
            newQuantity: newQty,
          });
        }

        // Case 2: subscription exists but no addon item yet -> create it and treat as updated flow
        if (targetSub && !addonItem) {
          // create new add-on item on existing subscription
          const created = await stripe.subscriptionItems.create({
            subscription: targetSub.id,
            price: priceId as string,
            quantity: quantity,
            proration_behavior: "create_prorations",
          } as any);

          // Persist recipients immediately (no webhook for this flow)
          try {
            const nowIso = new Date().toISOString();
            let userStripeId: number | undefined;
            const found = await supabaseAdmin
              .from("user_stripe")
              .select("id")
              .eq("stripe_subscription_id", targetSub.id)
              .maybeSingle();
            if (found.data?.id) {
              userStripeId = found.data.id as number;
              await supabaseAdmin
                .from("user_stripe")
                .update({ updated_at: nowIso, current_plan: plan })
                .eq("id", userStripeId);
            } else {
              const ins = await supabaseAdmin
                .from("user_stripe")
                .insert({
                  email: ownerEmail || null,
                  stripe_customer_id: stripeCustomerId,
                  stripe_subscription_id: targetSub.id,
                  current_plan: plan,
                  updated_at: nowIso,
                })
                .select("id")
                .maybeSingle();
              if (ins.data?.id) userStripeId = ins.data.id as number;
            }

            if (userStripeId && additionalEmails && additionalEmails.length > 0) {
              const rows = additionalEmails.map((em) => ({
                email: em,
                user_stripe_id: userStripeId!,
                plan,
                pending_removal: false,
                created_via: "addon" as const,
              }));
              const { error: recErr } = await supabaseAdmin
                .from("recipient_emails")
                .upsert(rows, { onConflict: "email" });
              if (recErr) console.warn("[checkout] recipients upsert after create failed", recErr);
            }
          } catch (persistErr) {
            console.warn("[checkout] post-create persistence failed", persistErr);
          }

          // Resolve product name for UI feedback
          let productName: string | undefined;
          try {
            const prodAny = (created as any)?.price?.product as any;
            const productId: string | undefined = typeof prodAny === "string" ? prodAny : prodAny?.id;
            if (productId) {
              const product = await stripe.products.retrieve(productId);
              productName = (product as any)?.name || undefined;
            }
          } catch {}

          const portal = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: `${baseUrl}/mypage?updated=1`,
          });

          return NextResponse.json({
            updated: true,
            portalUrl: (portal as any)?.url,
            productName: productName,
            newQuantity: quantity,
          });
        }
      } catch (e) {
        console.warn("[checkout] failed to create update session", e);
      }
    }

    // First-time decision: if we can find a valid subscription with a saved payment method via email, update directly;
    // otherwise instruct client to open a Payment Link in the same tab.
    if (!stripeCustomerId && ownerEmail) {
      try {
        const searchLimit = Number(process.env.STRIPE_CUSTOMER_SEARCH_LIMIT || 3);
        const customers = await stripe.customers.search({
          query: `email:'${ownerEmail.replace(/'/g, " ")}'`,
          limit: Number.isFinite(searchLimit) ? searchLimit : 3,
        } as any);

        const VALID = new Set(
          (process.env.SUBSCRIPTION_VALID_STATUSES || "active,trialing")
            .split(",")
            .map((v) => v.trim().toLowerCase())
            .filter(Boolean)
        );

        let targetSub: any | undefined;
        let candidateCustomerId: string | undefined;
        let addonItem: any | undefined;
        let hasSavedPaymentMethod = false;

        for (const c of customers.data) {
          const subs = await stripe.subscriptions.list({ customer: c.id, status: "all", limit: 20 });
          const cust = await stripe.customers.retrieve(c.id);
          const customerDefaultPm: any = (cust as any)?.invoice_settings?.default_payment_method ?? null;
          for (const s of subs.data as any[]) {
            if (!VALID.has(String(s.status).toLowerCase())) continue;
            const subDefaultPm: any = (s as any)?.default_payment_method ?? null;
            if (subDefaultPm || customerDefaultPm) {
              hasSavedPaymentMethod = true;
              targetSub = s;
              candidateCustomerId = c.id;
              const items = Array.isArray(s.items?.data) ? s.items.data : [];
              const ADDON_PRODUCT_IDS = new Set(
                ((plan === "lite"
                  ? process.env.STRIPE_ADDON_PRODUCT_IDS_LITE
                  : process.env.STRIPE_ADDON_PRODUCT_IDS_BUSINESS) || "")
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              );
              addonItem = items.find((it: any) => {
                const prodAny = it?.price?.product as any;
                const productId: string | undefined = typeof prodAny === "string" ? prodAny : prodAny?.id;
                return (productId && ADDON_PRODUCT_IDS.has(productId)) || it?.price?.id === priceId;
              });
              break;
            }
          }
          if (hasSavedPaymentMethod) break;
        }

        if (hasSavedPaymentMethod && targetSub && candidateCustomerId) {
          if (addonItem) {
            const currentQty =
              typeof addonItem.quantity === "number" && !Number.isNaN(addonItem.quantity)
                ? addonItem.quantity
                : 0;
            const newQty = currentQty + quantity;
            await stripe.subscriptionItems.update(addonItem.id, {
              quantity: newQty,
              proration_behavior: "create_prorations",
            } as any);

            try {
              const nowIso = new Date().toISOString();
              let userStripeId: number | undefined;
              const found = await supabaseAdmin
                .from("user_stripe")
                .select("id")
                .eq("stripe_subscription_id", targetSub.id)
                .maybeSingle();
              if (found.data?.id) {
                userStripeId = found.data.id as number;
                await supabaseAdmin
                  .from("user_stripe")
                  .update({ updated_at: nowIso, current_plan: plan, stripe_customer_id: candidateCustomerId })
                  .eq("id", userStripeId);
              } else {
                const ins = await supabaseAdmin
                  .from("user_stripe")
                  .insert({
                    email: ownerEmail || null,
                    stripe_customer_id: candidateCustomerId,
                    stripe_subscription_id: targetSub.id,
                    current_plan: plan,
                    updated_at: nowIso,
                  })
                  .select("id")
                  .maybeSingle();
                if (ins.data?.id) userStripeId = ins.data.id as number;
              }
              if (userStripeId && additionalEmails && additionalEmails.length > 0) {
                const rows = additionalEmails.map((em) => ({
                  email: em,
                  user_stripe_id: userStripeId!,
                  plan,
                  pending_removal: false,
                  created_via: "addon" as const,
                }));
                await supabaseAdmin.from("recipient_emails").upsert(rows, { onConflict: "email" });
              }
            } catch (persistErr) {
              console.warn("[checkout:first] persist after update failed", persistErr);
            }

            let productName: string | undefined;
            try {
              const prodAny = (addonItem as any)?.price?.product as any;
              const productId: string | undefined = typeof prodAny === "string" ? prodAny : prodAny?.id;
              if (productId) {
                const product = await stripe.products.retrieve(productId);
                productName = (product as any)?.name || undefined;
              }
            } catch {}
            const portal = await stripe.billingPortal.sessions.create({
              customer: candidateCustomerId,
              return_url: `${baseUrl}/mypage?updated=1`,
            });
            return NextResponse.json({ updated: true, portalUrl: (portal as any)?.url, productName, newQuantity: newQty });
          } else {
            const created = await stripe.subscriptionItems.create({
              subscription: targetSub.id,
              price: priceId as string,
              quantity: quantity,
              proration_behavior: "create_prorations",
            } as any);
            try {
              const nowIso = new Date().toISOString();
              let userStripeId: number | undefined;
              const found = await supabaseAdmin
                .from("user_stripe")
                .select("id")
                .eq("stripe_subscription_id", targetSub.id)
                .maybeSingle();
              if (found.data?.id) {
                userStripeId = found.data.id as number;
                await supabaseAdmin
                  .from("user_stripe")
                  .update({ updated_at: nowIso, current_plan: plan, stripe_customer_id: candidateCustomerId })
                  .eq("id", userStripeId);
              } else {
                const ins = await supabaseAdmin
                  .from("user_stripe")
                  .insert({
                    email: ownerEmail || null,
                    stripe_customer_id: candidateCustomerId,
                    stripe_subscription_id: targetSub.id,
                    current_plan: plan,
                    updated_at: nowIso,
                  })
                  .select("id")
                  .maybeSingle();
                if (ins.data?.id) userStripeId = ins.data.id as number;
              }
              if (userStripeId && additionalEmails && additionalEmails.length > 0) {
                const rows = additionalEmails.map((em) => ({
                  email: em,
                  user_stripe_id: userStripeId!,
                  plan,
                  pending_removal: false,
                  created_via: "addon" as const,
                }));
                await supabaseAdmin.from("recipient_emails").upsert(rows, { onConflict: "email" });
              }
            } catch (persistErr) {
              console.warn("[checkout:first] persist after create failed", persistErr);
            }

            let productName: string | undefined;
            try {
              const prodAny = (created as any)?.price?.product as any;
              const productId: string | undefined = typeof prodAny === "string" ? prodAny : prodAny?.id;
              if (productId) {
                const product = await stripe.products.retrieve(productId);
                productName = (product as any)?.name || undefined;
              }
            } catch {}
            const portal = await stripe.billingPortal.sessions.create({
              customer: candidateCustomerId,
              return_url: `${baseUrl}/mypage?updated=1`,
            });
            return NextResponse.json({ updated: true, portalUrl: (portal as any)?.url, productName, newQuantity: quantity });
          }
        }

        const paymentLinkUrl =
          (plan === "lite" && process.env.NEXT_PUBLIC_PL_ADDON_LITE_SEAT) ||
          (plan === "business" && process.env.NEXT_PUBLIC_PL_ADDON_BUS_SEAT) ||
          undefined;
        if (paymentLinkUrl) {
          return NextResponse.json({ url: paymentLinkUrl, isPaymentLink: true });
        }
      } catch (e) {
        console.warn("[checkout:first] email probe failed", e);
      }
    }


    if (!sessionUrl) {
      const createSession = await stripe.checkout.sessions.create({
        mode,
        line_items: [
          {
            price: priceId,
            quantity,
            adjustable_quantity: { enabled: true, minimum: 1, maximum: 10 },
          },
        ],
        success_url,
        cancel_url,
        customer: stripeCustomerId,
        customer_email: stripeCustomerId ? undefined : ownerEmail,
        metadata,
      });
      sessionUrl = (createSession as any)?.url;
    }

return NextResponse.json({ url: sessionUrl });
  } catch (e) {
    console.error("/api/stripe/checkout error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}


