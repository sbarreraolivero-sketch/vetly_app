// Mercado Pago Subscription Creation Edge Function
// Deploy with: supabase functions deploy mercadopago-create-subscription

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const MERCADOPAGO_ACCESS_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Plan prices in various currencies
const PLAN_PRICES: Record<string, Record<string, number>> = {
    essence: {
        CLP: 75000,
        ARS: 79000,
        MXN: 1400,
        COP: 310000,
        PEN: 300,
        USD: 79,
    },
    radiance: {
        CLP: 150000,
        ARS: 159000,
        MXN: 2800,
        COP: 620000,
        PEN: 600,
        USD: 159,
    },
    prestige: {
        CLP: 280000,
        ARS: 299000,
        MXN: 5200,
        COP: 1170000,
        PEN: 1120,
        USD: 299,
    },
};

const PLAN_DESCRIPTIONS: Record<string, string> = {
    essence: "Vetly - Plan Essence (2 Usuarios + Soft Luxury Agent)",
    radiance: "Vetly - Plan Radiance (5 Usuarios + Finanzas + Servicios)",
    prestige: "Vetly - Plan Prestige (Usuarios Ilimitados + Multi-sucursal)",
};

interface RequestBody {
    clinic_id: string;
    plan: "essence" | "radiance" | "prestige";
    email: string;
    currency?: string;
    external_reference: string;
    back_urls: {
        success: string;
        failure: string;
        pending: string;
    };
}

Deno.serve(async (req: Request) => {
    // Handle CORS
    if (req.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
            },
        });
    }

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const body: RequestBody = await req.json();
        const { clinic_id, plan, email, currency: reqCurrency, external_reference, back_urls } = body;

        // Validate required fields
        if (!clinic_id || !plan || !email) {
            return new Response(
                JSON.stringify({ error: "Missing required fields" }),
                { status: 400, headers: { "Content-Type": "application/json" } }
            );
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Determine currency (request -> database -> default CLP)
        let currency = reqCurrency;
        if (!currency) {
            const { data: settings } = await supabase
                .from('clinic_settings')
                .select('currency')
                .eq('id', clinic_id)
                .single();
            currency = settings?.currency || 'CLP';
        }

        // Get price for specific plan and currency
        const price = PLAN_PRICES[plan][currency] || PLAN_PRICES[plan]['USD'];

        // Create Mercado Pago preference
        const preferenceResponse = await fetch(
            "https://api.mercadopago.com/checkout/preferences",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
                },
                body: JSON.stringify({
                    items: [
                        {
                            title: PLAN_DESCRIPTIONS[plan],
                            quantity: 1,
                            unit_price: price,
                            currency_id: currency,
                        },
                    ],
                    payer: {
                        email: email,
                    },
                    back_urls: back_urls,
                    auto_return: "approved",
                    external_reference: external_reference,
                    notification_url: `${SUPABASE_URL}/functions/v1/mercadopago-webhook`,
                    metadata: {
                        clinic_id: clinic_id,
                        plan: plan,
                        type: 'subscription'
                    },
                }),
            }
        );

        if (!preferenceResponse.ok) {
            const errorData = await preferenceResponse.json();
            console.error("Mercado Pago error:", errorData);
            return new Response(
                JSON.stringify({ error: "Failed to create preference", details: errorData }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        const preference = await preferenceResponse.json();

        // Create pending subscription record in database
        await supabase.from("subscriptions").upsert({
            clinic_id: clinic_id,
            plan: plan,
            status: "trial",
            mercadopago_subscription_id: preference.id,
            trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days trial
            monthly_appointments_limit: plan === "essence" ? 50 : null,
            monthly_appointments_used: 0,
        }, {
            onConflict: "clinic_id",
        });

        return new Response(
            JSON.stringify({
                id: preference.id,
                init_point: preference.init_point,
                sandbox_init_point: preference.sandbox_init_point,
            }),
            {
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                },
            }
        );
    } catch (error) {
        console.error("Error:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
});
