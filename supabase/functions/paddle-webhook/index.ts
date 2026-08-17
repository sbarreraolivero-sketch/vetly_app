// Paddle Webhook Handler
// Recibe notificaciones de pago de Paddle y actualiza suscripción/créditos/referidos.
// Reemplaza a lemonsqueezy-webhook. Diferencias clave vs LS:
//   - Firma: header Paddle-Signature "ts=...;h1=...", payload firmado "ts:rawBody"
//   - Idempotencia explícita vía tabla paddle_webhook_events (Paddle reintenta webhooks)
//   - custom_data vive en data.custom_data (no en meta.custom_data como en LS)
//   - Eventos: subscription.created/updated/canceled, transaction.completed

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { limitsForPlan } from "../_shared/planLimits.ts";

const PADDLE_WEBHOOK_SECRET = Deno.env.get("PADDLE_WEBHOOK_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Tolerancia de replay — Paddle recomienda unos segundos, pero la latencia real
// de entrega de webhooks (reintentos, colas) puede superar eso ampliamente.
// Usamos 5 minutos, mismo orden de magnitud que otros webhooks de este proyecto.
const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;

/**
 * Verifica la firma Paddle-Signature: "ts=<unix>;h1=<hex>".
 * Falla cerrado si falta el header, el secret, o si el timestamp es muy viejo.
 */
function verifyPaddleSignature(rawBody: string, signatureHeader: string | null): boolean {
    if (!signatureHeader || !PADDLE_WEBHOOK_SECRET) {
        console.error("CRITICAL: Missing Paddle-Signature header or webhook secret — rejecting request");
        return false;
    }

    const parts = Object.fromEntries(
        signatureHeader.split(";").map((p) => {
            const [k, v] = p.split("=");
            return [k, v];
        })
    );
    const ts = parts["ts"];
    const h1 = parts["h1"];
    if (!ts || !h1) {
        console.error("Malformed Paddle-Signature header");
        return false;
    }

    const ageSeconds = Math.abs(Date.now() / 1000 - Number(ts));
    if (!Number.isFinite(ageSeconds) || ageSeconds > MAX_SIGNATURE_AGE_SECONDS) {
        console.error(`Paddle-Signature timestamp too old/invalid: age=${ageSeconds}s`);
        return false;
    }

    const signedPayload = `${ts}:${rawBody}`;
    const expectedDigest = createHmac("sha256", PADDLE_WEBHOOK_SECRET).update(signedPayload).digest("hex");

    const expectedBuf = Buffer.from(expectedDigest, "hex");
    const receivedBuf = Buffer.from(h1, "hex");
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
}

interface PaddleWebhookPayload {
    event_id: string;
    event_type: string;
    occurred_at: string;
    data: {
        id: string;
        status?: string;
        customer_id?: string;
        origin?: string; // "web" | "subscription_recurring" | "subscription_payment_method_change" | ...
        subscription_id?: string;
        current_billing_period?: { starts_at: string; ends_at: string };
        custom_data?: {
            clinic_id?: string;
            type?: string;      // 'subscription' | 'ai_credits' | 'reminders' | 'campaign_credits'
            plan?: string;      // 'core' | 'starter' | 'pro' | 'enterprise' (+ legacy essence/radiance/prestige)
            credits?: string;
            model?: string;     // 'mini' | '4o'
            quantity?: string;
        } | null;
    };
}

// Los límites por plan vienen de la tabla `plan_limits` vía _shared/planLimits.ts.
// No declararlos inline aquí (antes había 4 mapeos divergentes entre funciones).

Deno.serve(async (req: Request) => {
    if (req.method === "GET") {
        return new Response("Paddle Webhook OK", { status: 200 });
    }
    if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    const rawBody = await req.text();
    const signature = req.headers.get("Paddle-Signature");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (!verifyPaddleSignature(rawBody, signature)) {
        console.error("Invalid Paddle webhook signature");
        return new Response("Invalid signature", { status: 401 });
    }

    let payload: PaddleWebhookPayload;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return new Response("Invalid JSON", { status: 400 });
    }

    // ─── Idempotencia — Paddle reintenta webhooks; sin esto los packs se duplicarían ───
    const { error: dedupeError } = await supabase
        .from("paddle_webhook_events")
        .insert({ event_id: payload.event_id });
    if (dedupeError) {
        // Violación de PK = evento ya procesado. Cualquier otro error de inserción
        // también responde 200 para no forzar un reintento infinito de Paddle,
        // pero se loguea para investigar.
        if (dedupeError.code === "23505") {
            console.log(`[Paddle] Event ${payload.event_id} already processed — skipping`);
            return new Response("OK (duplicate)", { status: 200 });
        }
        console.error("[Paddle] Error recording webhook event (processing anyway):", dedupeError);
    }

    try {
        const eventType = payload.event_type;
        const customData = payload.data.custom_data;

        console.log(`[Paddle Webhook] Event: ${eventType}, Data ID: ${payload.data.id}`);

        if (!customData?.clinic_id) {
            console.warn("No clinic_id in custom_data — ignoring event");
            return new Response("OK (no clinic_id)", { status: 200 });
        }

        const clinicId = customData.clinic_id;
        const purchaseType = customData.type || "subscription";

        // ─── AI Credits Purchase ───
        if (purchaseType === "ai_credits") {
            if (eventType !== "transaction.completed") {
                console.log(`Ignoring ${eventType} for ai_credits`);
                return new Response("OK", { status: 200 });
            }

            const creditsToAdd = parseInt(customData.credits || "0");
            const model = customData.model || "mini";
            const balanceField = model === "4o" ? "ai_credits_extra_4o" : "ai_credits_extra_balance";

            if (creditsToAdd <= 0) {
                console.error("Invalid credits amount:", creditsToAdd);
                return new Response("Invalid credits", { status: 400 });
            }

            const { data: settings, error: fetchError } = await supabase
                .from("clinic_settings")
                .select(balanceField)
                .eq("id", clinicId)
                .single();

            if (fetchError) {
                console.error("Error fetching clinic settings:", fetchError);
                return new Response("DB fetch error", { status: 500 });
            }

            const currentBalance = (settings as any)?.[balanceField] || 0;
            const newBalance = currentBalance + creditsToAdd;
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

            const { error: updateError } = await supabase
                .from("clinic_settings")
                .update({
                    [balanceField]: newBalance,
                    ai_credits_extra_expires_at: expiresAt,
                    payment_provider: "paddle",
                    paddle_customer_id: payload.data.customer_id || null,
                })
                .eq("id", clinicId);

            if (updateError) {
                console.error(`Error updating credits (${balanceField}):`, updateError);
                return new Response("DB update error", { status: 500 });
            }

            await supabase.from("ai_credit_transactions").insert({
                clinic_id: clinicId,
                type: "purchase",
                amount: creditsToAdd,
                balance_after: newBalance,
                description: `Compra créditos extra (${model}) vía Paddle`,
                metadata: { model, expires_at: expiresAt },
            });

            console.log(`[Paddle] AI Credits (${model}) for ${clinicId}: +${creditsToAdd} → Total: ${newBalance}`);
            return new Response("Credits OK", { status: 200 });
        }

        // ─── Reminder Units Purchase ───
        if (purchaseType === "reminders") {
            if (eventType !== "transaction.completed") {
                console.log(`Ignoring ${eventType} for reminders`);
                return new Response("OK", { status: 200 });
            }

            const unitsToAdd = parseInt(customData.quantity || "0");
            if (unitsToAdd <= 0) {
                console.error("Invalid reminder units amount:", unitsToAdd);
                return new Response("Invalid quantity", { status: 400 });
            }

            const { data: sub, error: fetchError } = await supabase
                .from("subscriptions")
                .select("reminders_pack_balance")
                .eq("clinic_id", clinicId)
                .single();

            if (fetchError) {
                console.error("Error fetching subscription:", fetchError);
                return new Response("DB fetch error", { status: 500 });
            }

            const newBalance = (sub?.reminders_pack_balance || 0) + unitsToAdd;

            const { error: updateError } = await supabase
                .from("subscriptions")
                .update({ reminders_pack_balance: newBalance })
                .eq("clinic_id", clinicId);

            if (updateError) {
                console.error("Error updating reminder balance:", updateError);
                return new Response("DB update error", { status: 500 });
            }

            console.log(`[Paddle] Reminders for ${clinicId}: +${unitsToAdd} → Balance: ${newBalance}`);
            return new Response("Reminders OK", { status: 200 });
        }

        // ─── Campaign Credits Purchase ───
        if (purchaseType === "campaign_credits") {
            if (eventType !== "transaction.completed") {
                console.log(`Ignoring ${eventType} for campaign_credits`);
                return new Response("OK", { status: 200 });
            }

            const creditsToAdd = parseInt(customData.quantity || "0");
            if (creditsToAdd <= 0) {
                console.error("Invalid campaign credits amount:", creditsToAdd);
                return new Response("Invalid quantity", { status: 400 });
            }

            const { data: sub, error: fetchError } = await supabase
                .from("subscriptions")
                .select("campaign_credits_balance")
                .eq("clinic_id", clinicId)
                .single();

            if (fetchError) {
                console.error("Error fetching subscription for campaign_credits:", fetchError);
                return new Response("DB fetch error", { status: 500 });
            }

            const newBalance = (sub?.campaign_credits_balance || 0) + creditsToAdd;

            const { error: updateError } = await supabase
                .from("subscriptions")
                .update({ campaign_credits_balance: newBalance })
                .eq("clinic_id", clinicId);

            if (updateError) {
                console.error("Error updating campaign_credits_balance:", updateError);
                return new Response("DB update error", { status: 500 });
            }

            console.log(`[Paddle] Campaign credits for ${clinicId}: +${creditsToAdd} → Balance: ${newBalance}`);
            return new Response("Campaign Credits OK", { status: 200 });
        }

        // ─── Subscription Events ───
        const plan = customData.plan || "core";

        switch (eventType) {
            case "subscription.created": {
                const status = payload.data.status;
                const periodEnd = payload.data.current_billing_period?.ends_at;

                const limits = await limitsForPlan(supabase, plan);
                const maxUsers = limits.max_users;
                const maxAgendas = limits.max_agendas;
                const remindersLimit = limits.monthly_reminders;
                const aiCreditsLimit = limits.ai_credits;
                // billing_period viaja en customData desde openPaddleSubscriptionCheckout
                const billingPeriod = customData.billing_period === "year" ? "year" : "month";

                await supabase.from("subscriptions").upsert({
                    clinic_id: clinicId,
                    plan: plan,
                    // plan_id es la columna que lee el frontend (Settings.tsx) como fuente
                    // primaria del plan mostrado — mercadopago-webhook también la escribe.
                    // Escribir solo "plan" (como se hacía originalmente, heredado de LS)
                    // deja el plan mostrado desactualizado tras cualquier upgrade real.
                    plan_id: plan,
                    status: status === "active" || status === "trialing" ? "active" : "trial",
                    paddle_subscription_id: payload.data.id,
                    current_period_start: new Date().toISOString(),
                    current_period_end: periodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                    monthly_appointments_limit: null,
                    max_agendas: maxAgendas,
                    monthly_reminders_limit: remindersLimit,
                    monthly_appointments_used: 0,
                    monthly_reminders_used: 0,
                    billing_period: billingPeriod,
                }, { onConflict: "clinic_id" });

                await supabase
                    .from("clinic_settings")
                    .update({
                        subscription_plan: plan,
                        payment_provider: "paddle",
                        paddle_customer_id: payload.data.customer_id || null,
                        max_users: maxUsers,
                        ai_credits_monthly_limit: aiCreditsLimit,
                    })
                    .eq("id", clinicId);

                // ─── Referral B2B reward (idempotent via clinic_referrals.status='pending') ───
                try {
                    const { data: referral } = await supabase
                        .from("clinic_referrals")
                        .select("id, referrer_clinic_id")
                        .eq("referred_clinic_id", clinicId)
                        .eq("status", "pending")
                        .maybeSingle();

                    if (referral) {
                        if (plan === "core") {
                            const { data: referrerSub } = await supabase
                                .from("subscriptions")
                                .select("current_period_end")
                                .eq("clinic_id", referral.referrer_clinic_id)
                                .maybeSingle();
                            const base = referrerSub?.current_period_end ? new Date(referrerSub.current_period_end) : new Date();
                            base.setMonth(base.getMonth() + 2);
                            await supabase.from("subscriptions").update({ current_period_end: base.toISOString() }).eq("clinic_id", referral.referrer_clinic_id);
                            await supabase.from("clinic_referrals").update({
                                status: "qualified", reward_type: "free_months", reward_amount: 2, rewarded_at: new Date().toISOString(),
                            }).eq("id", referral.id);
                        } else {
                            // Precios corregidos (sesión 66) — LS_REFERRAL_PRICES original tenía 97/167/297 desactualizados.
                            const PADDLE_REFERRAL_PRICES: Record<string, number> = {
                                starter: 89, essence: 89,
                                pro: 169, radiance: 169,
                                enterprise: 349, prestige: 349,
                            };
                            const price = PADDLE_REFERRAL_PRICES[plan] ?? 0;
                            await supabase.from("clinic_referrals").update({
                                status: "qualified", reward_type: "cash_commission",
                                reward_amount: Math.round(price * 50) / 100, reward_currency: "USD",
                                rewarded_at: new Date().toISOString(),
                            }).eq("id", referral.id);
                        }
                    }
                } catch (e) {
                    console.error("[Paddle] Referral reward error (non-fatal):", e);
                }

                console.log(`[Paddle] Subscription created: ${clinicId} → ${plan} (${status})`);

                // ─── Send Activation Email (Async) ───
                if (status === "active" || status === "trialing") {
                    try {
                        const { data: ownerProfile } = await supabase
                            .from("clinic_members")
                            .select("email, first_name")
                            .eq("clinic_id", clinicId)
                            .eq("role", "owner")
                            .limit(1)
                            .single();

                        if (ownerProfile) {
                            const monthlyLimit = plan === "prestige" ? 5000 : (plan === "radiance" ? 2500 : 1000);
                            const ai4oLimit = plan === "prestige" ? 300 : (plan === "radiance" ? 200 : 100);

                            fetch(`${SUPABASE_URL}/functions/v1/send-plan-activated-email`, {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                                },
                                body: JSON.stringify({
                                    email: ownerProfile.email,
                                    full_name: ownerProfile.first_name,
                                    plan_name: plan,
                                    monthly_limit: monthlyLimit,
                                    ai_4o_limit: ai4oLimit,
                                }),
                            }).catch((err) => console.error("Error triggering activation email (Paddle):", err));
                        }
                    } catch (e) {
                        console.warn("Activation email trigger failed (Paddle):", e);
                    }
                }
                break;
            }

            case "subscription.updated": {
                const status = payload.data.status;
                const periodEnd = payload.data.current_billing_period?.ends_at;

                let dbStatus = "active";
                if (status === "canceled") dbStatus = "cancelled";
                if (status === "past_due") dbStatus = "past_due";
                if (status === "paused") dbStatus = "cancelled";
                if (status === "trialing") dbStatus = "trial";

                const subUpdate: Record<string, unknown> = {
                    status: dbStatus,
                    current_period_end: periodEnd || null,
                };

                // Un upgrade/downgrade dentro de Paddle llega como subscription.updated.
                // Antes solo se tocaba el status, así que los límites quedaban con los
                // valores del plan viejo indefinidamente. Si el evento trae el plan en
                // custom_data, se reescriben; si no, se deja intacto para no degradar
                // a nadie por un payload incompleto.
                const updatedPlan = customData.plan;
                if (updatedPlan) {
                    const limits = await limitsForPlan(supabase, updatedPlan);
                    subUpdate.plan = updatedPlan;
                    subUpdate.plan_id = updatedPlan;
                    subUpdate.max_agendas = limits.max_agendas;
                    subUpdate.monthly_reminders_limit = limits.monthly_reminders;

                    await supabase
                        .from("clinic_settings")
                        .update({
                            subscription_plan: updatedPlan,
                            max_users: limits.max_users,
                            ai_credits_monthly_limit: limits.ai_credits,
                        })
                        .eq("id", clinicId);
                }

                await supabase
                    .from("subscriptions")
                    .update(subUpdate)
                    .eq("clinic_id", clinicId);

                console.log(`[Paddle] Subscription updated: ${clinicId} → ${dbStatus}${updatedPlan ? ` (plan ${updatedPlan})` : ""}`);
                break;
            }

            case "subscription.canceled": {
                await supabase
                    .from("subscriptions")
                    .update({ status: "cancelled" })
                    .eq("clinic_id", clinicId);

                console.log(`[Paddle] Subscription cancelled: ${clinicId}`);
                break;
            }

            case "transaction.completed": {
                // Renovación de suscripción existente (no la primera compra, esa la maneja
                // subscription.created). Paddle marca el origen de la transacción.
                if (payload.data.origin === "subscription_recurring") {
                    await supabase
                        .from("subscriptions")
                        .update({
                            status: "active",
                            current_period_start: new Date().toISOString(),
                            current_period_end: payload.data.current_billing_period?.ends_at
                                || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                            monthly_appointments_used: 0,
                            monthly_reminders_used: 0,
                            reminders_pack_balance: 0, // Packs no se acumulan: se reinician en cada renovación
                        })
                        .eq("clinic_id", clinicId);

                    console.log(`[Paddle] Payment success (renewal): ${clinicId}`);
                } else {
                    console.log(`[Paddle] transaction.completed (initial, handled by subscription.created): ${clinicId}`);
                }
                break;
            }

            default:
                console.log(`[Paddle] Unhandled event: ${eventType}`);
        }

        return new Response("OK", { status: 200 });
    } catch (error: any) {
        console.error("[Paddle Webhook] Error:", error);
        return new Response("Internal error", { status: 500 });
    }
});
