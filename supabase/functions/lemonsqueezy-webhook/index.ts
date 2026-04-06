// LemonSqueezy Webhook Handler
// Receives payment notifications and updates subscription/credits status

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const LEMONSQUEEZY_WEBHOOK_SECRET = Deno.env.get("LEMONSQUEEZY_WEBHOOK_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/**
 * Verify the webhook signature from LemonSqueezy
 */
function verifySignature(payload: string, signature: string | null): boolean {
    if (!signature || !LEMONSQUEEZY_WEBHOOK_SECRET) {
        console.warn("Missing signature or webhook secret — skipping verification");
        return !LEMONSQUEEZY_WEBHOOK_SECRET; // Allow if secret not configured (dev mode)
    }

    const hmac = createHmac("sha256", LEMONSQUEEZY_WEBHOOK_SECRET);
    const digest = hmac.update(payload).digest("hex");
    return digest === signature;
}

interface LemonSqueezyWebhookPayload {
    meta: {
        event_name: string;
        custom_data?: {
            clinic_id?: string;
            type?: string;      // 'subscription' | 'ai_credits'
            plan?: string;      // 'essence' | 'radiance' | 'prestige'
            credits?: string;   // '500' | '1500' | '4000'
            model?: string;     // 'mini' | '4o'
        };
    };
    data: {
        id: string;
        type: string;
        attributes: {
            status: string;
            first_order_item?: {
                variant_id: number;
                price: number;
            };
            customer_id?: number;
            order_number?: number;
            total?: number;
            total_formatted?: string;
            urls?: {
                customer_portal?: string;
            };
            renews_at?: string;
            ends_at?: string | null;
            created_at?: string;
        };
    };
}

Deno.serve(async (req: Request) => {
    // Handle GET (health check)
    if (req.method === "GET") {
        return new Response("LemonSqueezy Webhook OK", { status: 200 });
    }

    if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    try {
        const rawBody = await req.text();
        const signature = req.headers.get("x-signature");

        // Verify signature
        if (!verifySignature(rawBody, signature)) {
            console.error("Invalid webhook signature");
            return new Response("Invalid signature", { status: 401 });
        }

        const payload: LemonSqueezyWebhookPayload = JSON.parse(rawBody);
        const eventName = payload.meta.event_name;
        const customData = payload.meta.custom_data;

        console.log(`[LS Webhook] Event: ${eventName}, Data ID: ${payload.data.id}`);

        if (!customData?.clinic_id) {
            console.warn("No clinic_id in custom_data — ignoring event");
            return new Response("OK (no clinic_id)", { status: 200 });
        }

        const clinicId = customData.clinic_id;
        const purchaseType = customData.type || 'subscription';
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // ─── AI Credits Purchase ───
        if (purchaseType === 'ai_credits') {
            // Only process on successful order
            if (eventName !== 'order_created') {
                console.log(`Ignoring ${eventName} for ai_credits`);
                return new Response("OK", { status: 200 });
            }

            const creditsToAdd = parseInt(customData.credits || '0');
            const model = customData.model || 'mini';
            const balanceField = model === '4o' ? 'ai_credits_extra_4o' : 'ai_credits_extra_balance';

            if (creditsToAdd <= 0) {
                console.error("Invalid credits amount:", creditsToAdd);
                return new Response("Invalid credits", { status: 400 });
            }

            // Fetch current balance
            const { data: settings, error: fetchError } = await supabase
                .from('clinic_settings')
                .select(balanceField)
                .eq('id', clinicId)
                .single();

            if (fetchError) {
                console.error("Error fetching clinic settings:", fetchError);
                return new Response("DB fetch error", { status: 500 });
            }

            const currentBalance = (settings as any)?.[balanceField] || 0;
            const newBalance = currentBalance + creditsToAdd;

            // Update balance
            const { error: updateError } = await supabase
                .from('clinic_settings')
                .update({ 
                    [balanceField]: newBalance,
                    payment_provider: 'lemonsqueezy',
                })
                .eq('id', clinicId);

            if (updateError) {
                console.error(`Error updating credits (${balanceField}):`, updateError);
                return new Response("DB update error", { status: 500 });
            }

            console.log(`[LS] AI Credits (${model}) for ${clinicId}: +${creditsToAdd} → Total: ${newBalance}`);
            return new Response("Credits OK", { status: 200 });
        }

        // ─── Subscription Events ───
        const plan = customData.plan || 'essence';

        switch (eventName) {
            case 'subscription_created': {
                // New subscription activated
                const status = payload.data.attributes.status;
                const renewsAt = payload.data.attributes.renews_at;

                const maxUsers = plan === "essence" ? 2 : (plan === "radiance" ? 5 : 1000);
                const maxAgendas = plan === "essence" ? 1 : (plan === "radiance" ? 5 : 1000);
                const remindersLimit = plan === "radiance" ? 50 : (plan === "essence" ? 0 : 1000000);

                await supabase.from("subscriptions").upsert({
                    clinic_id: clinicId,
                    plan: plan,
                    status: status === 'active' ? 'active' : 'trial',
                    mercadopago_subscription_id: `ls_${payload.data.id}`, // Reuse field for LS ID
                    current_period_start: new Date().toISOString(),
                    current_period_end: renewsAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                    trial_ends_at: null,
                    monthly_appointments_limit: plan === 'essence' ? 50 : null,
                    max_agendas: maxAgendas,
                    monthly_reminders_limit: remindersLimit,
                    monthly_appointments_used: 0,
                    monthly_reminders_used: 0,
                }, { onConflict: "clinic_id" });

                // Update clinic settings
                await supabase
                    .from('clinic_settings')
                    .update({ 
                        subscription_plan: plan,
                        payment_provider: 'lemonsqueezy',
                        lemonsqueezy_customer_id: String(payload.data.attributes.customer_id || ''),
                        max_users: maxUsers,
                    })
                    .eq('id', clinicId);

                console.log(`[LS] Subscription created: ${clinicId} → ${plan} (${status})`);

                // ─── Send Activation Email (Async) ───
                if (status === 'active' || status === 'on_trial') {
                    try {
                        const { data: ownerProfile } = await supabase
                            .from("clinic_members")
                            .select("email, first_name")
                            .eq("clinic_id", clinicId)
                            .eq("role", "owner")
                            .limit(1)
                            .single();

                        if (ownerProfile) {
                            const monthlyLimit = plan === 'prestige' ? 5000 : (plan === 'radiance' ? 2500 : 1000);
                            const ai4oLimit = plan === 'prestige' ? 300 : (plan === 'radiance' ? 200 : 100);

                            fetch(`${SUPABASE_URL}/functions/v1/send-plan-activated-email`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                                },
                                body: JSON.stringify({
                                    email: ownerProfile.email,
                                    full_name: ownerProfile.first_name,
                                    plan_name: plan,
                                    monthly_limit: monthlyLimit,
                                    ai_4o_limit: ai4oLimit
                                })
                            }).catch(err => console.error("Error triggering activation email (LS):", err));
                        }
                    } catch (e) {
                        console.warn("Activation email trigger failed (LS):", e);
                    }
                }
                break;
            }

            case 'subscription_updated': {
                const status = payload.data.attributes.status;
                const renewsAt = payload.data.attributes.renews_at;
                const endsAt = payload.data.attributes.ends_at;

                let dbStatus = 'active';
                if (status === 'cancelled' || status === 'expired') dbStatus = 'cancelled';
                if (status === 'past_due') dbStatus = 'past_due';
                if (status === 'on_trial') dbStatus = 'trial';

                await supabase
                    .from("subscriptions")
                    .update({
                        status: dbStatus,
                        current_period_end: endsAt || renewsAt || null,
                    })
                    .eq("clinic_id", clinicId);

                console.log(`[LS] Subscription updated: ${clinicId} → ${dbStatus}`);
                break;
            }

            case 'subscription_payment_success': {
                // Successful renewal payment
                const renewsAt = payload.data.attributes.renews_at;

                await supabase
                    .from("subscriptions")
                    .update({
                        status: 'active',
                        current_period_start: new Date().toISOString(),
                        current_period_end: renewsAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                        monthly_appointments_used: 0, // Reset monthly counter
                        monthly_reminders_used: 0,    // Reset monthly counter
                    })
                    .eq("clinic_id", clinicId);

                console.log(`[LS] Payment success (renewal): ${clinicId}`);
                break;
            }

            case 'order_created': {
                // One-time order for subscription (initial payment)
                console.log(`[LS] Order created for subscription: ${clinicId} → ${plan}`);
                // Handled by subscription_created typically
                break;
            }

            default:
                console.log(`[LS] Unhandled event: ${eventName}`);
        }

        return new Response("OK", { status: 200 });
    } catch (error: any) {
        console.error("[LS Webhook] Error:", error);
        return new Response("Internal error", { status: 500 });
    }
});
