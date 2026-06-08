// Mercado Pago Webhook Handler
// Receives payment notifications and updates subscription status

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const MERCADOPAGO_ACCESS_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || "";
const MERCADOPAGO_WEBHOOK_SECRET = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function verifyMercadoPagoSignature(
    signatureHeader: string | null,
    requestId: string | null,
    dataId: string | null
): boolean {
    if (!MERCADOPAGO_WEBHOOK_SECRET || !signatureHeader) return false;
    const parts = Object.fromEntries(
        signatureHeader.split(",").map(p => {
            const idx = p.indexOf("=");
            return [p.slice(0, idx), p.slice(idx + 1)] as [string, string];
        })
    );
    const ts = parts["ts"];
    const v1 = parts["v1"];
    if (!ts || !v1) return false;
    const manifest = `id:${dataId ?? ""};request-id:${requestId ?? ""};ts:${ts};`;
    const digest = createHmac("sha256", MERCADOPAGO_WEBHOOK_SECRET).update(manifest).digest("hex");
    return digest === v1;
}

interface WebhookPayload {
    action: string;
    api_version: string;
    data: {
        id: string;
    };
    date_created: string;
    id: number;
    live_mode: boolean;
    type: string;
    user_id: string;
}

Deno.serve(async (req: Request) => {
    // Handle GET requests (verification from MP)
    if (req.method === "GET") {
        return new Response("OK", { status: 200 });
    }

    if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    try {
        const signature = req.headers.get("x-signature");
        const requestId = req.headers.get("x-request-id");

        const body = await req.text();
        const payload: WebhookPayload = JSON.parse(body);

        // Verify HMAC-SHA256 signature before processing any event
        if (!verifyMercadoPagoSignature(signature, requestId, payload.data?.id ?? null)) {
            console.warn("MercadoPago webhook: invalid or missing signature");
            return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
        }

        console.log("Webhook received:", payload.type, payload.data.id);

        // Only process payment notifications
        if (payload.type !== "payment") {
            return new Response("OK", { status: 200 });
        }

        // Get payment details from Mercado Pago
        const paymentResponse = await fetch(
            `https://api.mercadopago.com/v1/payments/${payload.data.id}`,
            {
                headers: {
                    Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
                },
            }
        );

        if (!paymentResponse.ok) {
            console.error("Failed to fetch payment details");
            return new Response("Failed to fetch payment", { status: 500 });
        }

        const payment = await paymentResponse.json();
        console.log("Payment status:", payment.status);

        // Extract clinic_id, plan, and purchase type from metadata or external_reference
        const clinicId = payment.metadata?.clinic_id || payment.external_reference;
        const purchaseType = payment.metadata?.type || 'subscription';
        
        if (!clinicId) {
            console.error("No clinic_id found in payment");
            return new Response("No clinic_id", { status: 400 });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Handle AI Credit Purchases
        if (purchaseType === 'ai_credits' && payment.status === 'approved') {
            const creditsToAdd = parseInt(payment.metadata?.credits || '0');
            const model = payment.metadata?.model || 'mini';
            const balanceField = model === '4o' ? 'ai_credits_extra_4o' : 'ai_credits_extra_balance';
            
            if (creditsToAdd > 0) {
                // Fetch current extra balance
                const { data: settings, error: fetchError } = await supabase
                    .from('clinic_settings')
                    .select(balanceField)
                    .eq('id', clinicId)
                    .single();

                if (fetchError) {
                    console.error("Error fetching clinic settings:", fetchError);
                    return new Response("Error fetching settings", { status: 500 });
                }

                const currentBalance = (settings as any)?.[balanceField] || 0;
                const newBalance = currentBalance + creditsToAdd;
                const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

                // Update balance + set expiry
                const { error: updateError } = await supabase
                    .from('clinic_settings')
                    .update({
                        [balanceField]: newBalance,
                        ai_credits_extra_expires_at: expiresAt,
                    })
                    .eq('id', clinicId);

                if (updateError) {
                    console.error(`Error updating credits (${balanceField}):`, updateError);
                    return new Response("Error updating credits", { status: 500 });
                }

                // Register transaction
                await supabase.from('ai_credit_transactions').insert({
                    clinic_id: clinicId,
                    type: 'purchase',
                    amount: creditsToAdd,
                    balance_after: newBalance,
                    description: `Compra créditos extra (${model}) vía MercadoPago`,
                    metadata: { model, expires_at: expiresAt }
                });

                console.log(`AI Credits (${model}) updated for ${clinicId}: +${creditsToAdd} -> Total Extra: ${newBalance}`);
                return new Response(`AI Credits (${model}) OK`, { status: 200 });
            }
        }

        // Default: Update subscription logic (existing code)
        let subscriptionStatus: string;
        let periodEnd: Date | null = null;

        switch (payment.status) {
            case "approved":
                subscriptionStatus = "active";
                // Set period end to 30 days from now
                periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                break;
            case "pending":
            case "in_process":
                subscriptionStatus = "trial";
                break;
            case "rejected":
            case "cancelled":
                subscriptionStatus = "cancelled";
                break;
            default:
                subscriptionStatus = "trial";
        }

        const plan = payment.metadata?.plan || 'essence';
        const updateData: Record<string, unknown> = {
            status: subscriptionStatus,
            plan_id: plan,
            mercadopago_subscription_id: payload.data.id,
        };

        if (periodEnd) {
            updateData.current_period_start = new Date().toISOString();
            updateData.current_period_end = periodEnd.toISOString();
            updateData.trial_ends_at = null; // Clear trial
        }

        // 1. Update subscription in database
        const { error } = await supabase
            .from("subscriptions")
            .update(updateData)
            .eq("clinic_id", clinicId);

        if (error) {
            console.error("Database update error:", error);
            return new Response("Database error", { status: 500 });
        }

        // 2. Sync limits to clinic_settings
        if (subscriptionStatus === 'active') {
            const { error: syncError } = await supabase
                .from("clinic_settings")
                .update({
                    subscription_plan: plan,
                    ai_credits_monthly_limit: ['enterprise', 'prestige'].includes(plan) ? 30000 : ['pro', 'radiance'].includes(plan) ? 10000 : ['starter', 'essence'].includes(plan) ? 5000 : 0,
                    ai_credits_monthly_4o_limit: ['enterprise', 'prestige'].includes(plan) ? 999999 : ['pro', 'radiance'].includes(plan) ? 999999 : ['starter', 'essence'].includes(plan) ? 999999 : 0,
                    max_users: plan === 'prestige' ? 999999 : (plan === 'radiance' ? 5 : 2),
                })
                .eq("id", clinicId);
            
            if (syncError) console.error("Error syncing limits from MP:", syncError);

            // 3. Send Activation Email (Async)
            try {
                // Fetch owner profile for personalization
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
                    }).catch(err => console.error("Error triggering activation email:", err));
                }
            } catch (e) {
                console.warn("Activation email trigger failed (skipping):", e);
            }
        }

        console.log(`Subscription updated: ${clinicId} -> ${subscriptionStatus} (Plan: ${plan})`);

        return new Response("OK", { status: 200 });
    } catch (error) {
        console.error("Webhook error:", error);
        return new Response("Internal error", { status: 500 });
    }
});
