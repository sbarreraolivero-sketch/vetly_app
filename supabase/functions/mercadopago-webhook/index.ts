// Mercado Pago Webhook Handler
// Receives payment notifications and updates subscription status

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const MERCADOPAGO_ACCESS_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || "";
const MERCADOPAGO_WEBHOOK_SECRET = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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
        // Verify webhook signature (optional but recommended)
        const signature = req.headers.get("x-signature");
        const requestId = req.headers.get("x-request-id");

        const body = await req.text();
        const payload: WebhookPayload = JSON.parse(body);

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

                // Update balance
                const { error: updateError } = await supabase
                    .from('clinic_settings')
                    .update({ [balanceField]: newBalance })
                    .eq('id', clinicId);

                if (updateError) {
                    console.error(`Error updating credits (${balanceField}):`, updateError);
                    return new Response("Error updating credits", { status: 500 });
                }

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

        // Update subscription in database
        const updateData: Record<string, unknown> = {
            status: subscriptionStatus,
            mercadopago_subscription_id: payload.data.id,
        };

        if (periodEnd) {
            updateData.current_period_start = new Date().toISOString();
            updateData.current_period_end = periodEnd.toISOString();
            updateData.trial_ends_at = null; // Clear trial
        }

        const { error } = await supabase
            .from("subscriptions")
            .update(updateData)
            .eq("clinic_id", clinicId);

        if (error) {
            console.error("Database update error:", error);
            return new Response("Database error", { status: 500 });
        }

        console.log(`Subscription updated: ${clinicId} -> ${subscriptionStatus}`);

        return new Response("OK", { status: 200 });
    } catch (error) {
        console.error("Webhook error:", error);
        return new Response("Internal error", { status: 500 });
    }
});
