import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const MERCADOPAGO_ACCESS_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";

const CREDIT_PACKS_MINI: Record<string, { credits: number, prices: Record<string, number>, description: string }> = {
    'pack_500': { 
        credits: 500, 
        prices: { CLP: 5000, ARS: 5000, MXN: 100, COP: 20000, PEN: 20, USD: 5 },
        description: "Pack Inicial - 500 Créditos de IA (GPT-4o-mini)" 
    },
    'pack_1500': { 
        credits: 1500, 
        prices: { CLP: 12000, ARS: 12000, MXN: 250, COP: 50000, PEN: 50, USD: 12 },
        description: "Pack Pro - 1500 Créditos de IA (GPT-4o-mini)" 
    },
    'pack_4000': { 
        credits: 4000, 
        prices: { CLP: 25000, ARS: 25000, MXN: 500, COP: 100000, PEN: 100, USD: 25 },
        description: "Pack Enterprise - 4000 Créditos de IA (GPT-4o-mini)" 
    },
};

const CREDIT_PACKS_4O: Record<string, { credits: number, prices: Record<string, number>, description: string }> = {
    'pack_500_4o': { 
        credits: 500, 
        prices: { CLP: 10000, ARS: 10000, MXN: 200, COP: 40000, PEN: 40, USD: 10 },
        description: "Pack Inicial - 500 Créditos de IA (GPT-4o)" 
    },
    'pack_1500_4o': { 
        credits: 1500, 
        prices: { CLP: 30000, ARS: 30000, MXN: 600, COP: 120000, PEN: 120, USD: 30 },
        description: "Pack Pro - 1500 Créditos de IA (GPT-4o)" 
    },
    'pack_4000_4o': { 
        credits: 4000, 
        prices: { CLP: 80000, ARS: 80000, MXN: 1600, COP: 320000, PEN: 320, USD: 80 },
        description: "Pack Enterprise - 4000 Créditos de IA (GPT-4o)" 
    },
};

interface RequestBody {
    clinic_id: string;
    pack_id: string;
    email: string;
    currency?: string;
    model?: 'mini' | '4o';
    back_urls: {
        success: string;
        failure: string;
        pending: string;
    };
}

Deno.serve(async (req: Request) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
    };

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    try {
        const body: RequestBody = await req.json();
        const { clinic_id, pack_id, email, currency: reqCurrency, model, back_urls } = body;

        const selectedModel = model || 'mini';
        const packs = selectedModel === '4o' ? CREDIT_PACKS_4O : CREDIT_PACKS_MINI;

        console.log(`Creating preference for clinic ${clinic_id}, pack ${pack_id}, model ${selectedModel}, email ${email}`);

        const pack = packs[pack_id];

        if (!clinic_id || !pack || !email) {
            console.error("Missing required fields:", { clinic_id, pack_id, email, selectedModel });
            return new Response(
                JSON.stringify({ error: "Missing required fields or invalid pack" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");

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

        // Get price for specific pack and currency
        const price = pack.prices[currency] || pack.prices['USD'];

        if (!MERCADOPAGO_ACCESS_TOKEN) {
            console.error("MERCADOPAGO_ACCESS_TOKEN is not set in environment");
            return new Response(
                JSON.stringify({ error: "Server configuration error: Missing MP token" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Create Mercado Pago preference with normalized back_urls
        const mpPayload = {
            items: [
                {
                    title: pack.description,
                    quantity: 1,
                    unit_price: price,
                    currency_id: currency,
                },
            ],
            payer: {
                email: email,
            },
            back_urls: {
                success: back_urls?.success || "https://vetly.pro/app/dashboard",
                failure: back_urls?.failure || "https://vetly.pro/app/dashboard",
                pending: back_urls?.pending || "https://vetly.pro/app/dashboard"
            },
            auto_return: "approved",
            external_reference: clinic_id,
            notification_url: `${SUPABASE_URL}/functions/v1/mercadopago-webhook`,
            metadata: {
                clinic_id: clinic_id,
                type: "ai_credits",
                credits: pack.credits.toString(),
                model: selectedModel,
            },
        };

        const preferenceResponse = await fetch(
            "https://api.mercadopago.com/checkout/preferences",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
                },
                body: JSON.stringify(mpPayload),
            }
        );

        if (!preferenceResponse.ok) {
            const errorData = await preferenceResponse.json();
            console.error("Mercado Pago API error:", errorData);
            return new Response(
                JSON.stringify({ error: "Failed to create preference with MP", details: errorData }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const preference = await preferenceResponse.json();
        console.log("Preference created successfully:", preference.id);

        return new Response(
            JSON.stringify({
                id: preference.id,
                init_point: preference.init_point,
                sandbox_init_point: preference.sandbox_init_point,
            }),
            {
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                },
            }
        );
    } catch (error: any) {
        console.error("Internal processing error:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error", message: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
