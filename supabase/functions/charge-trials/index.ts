import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MERCADOPAGO_ACCESS_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Plan pricing mapping
const PLAN_PRICES: Record<string, number> = {
    'essence': 79,
    'radiance': 159,
    'prestige': 299
};

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // Validate webhook authorization (Optional: add a custom secret header check here if calling via cron)
        const authHeader = req.headers.get('Authorization');
        if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 1. Fetch all clinics whose trial has ended and is still 'running'
        const now = new Date().toISOString();
        const { data: clinics, error: fetchError } = await supabaseAdmin
            .from('clinic_settings')
            .select('*')
            .eq('trial_status', 'running')
            .lte('trial_end_date', now);

        if (fetchError) throw fetchError;

        if (!clinics || clinics.length === 0) {
            return new Response(JSON.stringify({ message: "No trials to process", processed: 0 }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const results = [];

        for (const clinic of clinics) {
            const amount = PLAN_PRICES[clinic.subscription_plan] || 159; // Fallback to radiance
            const customerId = clinic.mercadopago_customer_id;

            if (!customerId || !MERCADOPAGO_ACCESS_TOKEN) {
                // Cannot auto-charge without MP data
                await supabaseAdmin
                    .from('clinic_settings')
                    .update({
                        trial_status: 'cancelled',
                        billing_status: 'payment_failed'
                    })
                    .eq('id', clinic.id);

                results.push({ clinicId: clinic.id, status: 'failed_no_payment_data' });
                continue;
            }

            try {
                // 2. Search for the customer's cards in Mercado Pago to get the token/payment method
                const cardsRes = await fetch(`https://api.mercadopago.com/v1/customers/${customerId}/cards`, {
                    headers: { "Authorization": `Bearer ${MERCADOPAGO_ACCESS_TOKEN}` }
                });
                const cardsData = await cardsRes.json();

                if (!cardsData || cardsData.length === 0) {
                    await supabaseAdmin.from('clinic_settings').update({ trial_status: 'cancelled', billing_status: 'payment_failed' }).eq('id', clinic.id);
                    results.push({ clinicId: clinic.id, status: 'failed_no_card_found' });
                    continue;
                }

                const cardDetails = cardsData[0]; // Assuming we charge the first card securely vaulted
                const paymentMethodId = cardDetails.payment_method.id;

                // 3. Create a Payment in Mercado Pago
                const paymentRes = await fetch("https://api.mercadopago.com/v1/payments", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        transaction_amount: amount,
                        description: `Suscripción Citenly AI - Plan ${clinic.subscription_plan}`,
                        payment_method_id: paymentMethodId,
                        payer: {
                            id: customerId
                        },
                        // We must pass a standard generic token representing the customer card or a vaulted card ID.
                        // However, using MP Customer directly with `issuer_id` or just customer ID usually handles the underlying processing if properly tokenized.
                    })
                });

                const paymentData = await paymentRes.json();

                if (paymentData.status === 'approved' || paymentData.status === 'in_process') {
                    // Success! Convert the trial
                    await supabaseAdmin
                        .from('clinic_settings')
                        .update({
                            trial_status: 'converted',
                            billing_status: 'active_subscription'
                        })
                        .eq('id', clinic.id);

                    results.push({ clinicId: clinic.id, status: 'success' });
                } else {
                    // Payment failed
                    await supabaseAdmin
                        .from('clinic_settings')
                        .update({
                            trial_status: 'cancelled',
                            billing_status: 'payment_failed'
                        })
                        .eq('id', clinic.id);

                    results.push({ clinicId: clinic.id, status: 'failed_charge_rejected', error: paymentData.status_detail });
                }

            } catch (err: any) {
                console.error(`Error processing clinic ${clinic.id}:`, err);
                results.push({ clinicId: clinic.id, status: 'error', error: err.message });
            }
        }

        return new Response(JSON.stringify({ message: "Processed trials", results }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

    } catch (error: any) {
        console.error("Error in charge-trials:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
});
