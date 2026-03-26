// LemonSqueezy Create Checkout - Edge Function
// Creates a checkout session for international clients (USD)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const LEMONSQUEEZY_API_KEY = Deno.env.get("LEMONSQUEEZY_API_KEY") || "";
const LEMONSQUEEZY_STORE_ID = Deno.env.get("LEMONSQUEEZY_STORE_ID") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/**
 * LemonSqueezy Variant IDs — replace these with real IDs from your LS dashboard.
 * To find them: Dashboard → Store → Products → Click product → Copy variant ID from URL.
 */
const VARIANT_IDS: Record<string, string> = {
    // Subscription Plans
    'essence':     Deno.env.get("LS_VARIANT_ESSENCE") || "PLACEHOLDER_ESSENCE",
    'radiance':    Deno.env.get("LS_VARIANT_RADIANCE") || "PLACEHOLDER_RADIANCE",
    'prestige':    Deno.env.get("LS_VARIANT_PRESTIGE") || "PLACEHOLDER_PRESTIGE",
    // AI Credit Packs (mini)
    'pack_500':    Deno.env.get("LS_VARIANT_PACK_500") || "PLACEHOLDER_PACK_500",
    'pack_1500':   Deno.env.get("LS_VARIANT_PACK_1500") || "PLACEHOLDER_PACK_1500",
    'pack_4000':   Deno.env.get("LS_VARIANT_PACK_4000") || "PLACEHOLDER_PACK_4000",
    // AI Credit Packs (4o premium)
    'pack_500_4o':  Deno.env.get("LS_VARIANT_PACK_500_4O") || "PLACEHOLDER_PACK_500_4O",
    'pack_1500_4o': Deno.env.get("LS_VARIANT_PACK_1500_4O") || "PLACEHOLDER_PACK_1500_4O",
    'pack_4000_4o': Deno.env.get("LS_VARIANT_PACK_4000_4O") || "PLACEHOLDER_PACK_4000_4O",
};

interface RequestBody {
    clinic_id: string;
    email: string;
    type: 'subscription' | 'ai_credits';
    plan_or_pack_id: string;  // e.g. 'essence', 'pack_500', 'pack_1500_4o'
    model?: 'mini' | '4o';    // for credits only
    success_url?: string;
}

Deno.serve(async (req: Request) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
    };

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
        const { clinic_id, email, type, plan_or_pack_id, model, success_url } = body;

        if (!clinic_id || !email || !plan_or_pack_id) {
            return new Response(
                JSON.stringify({ error: "Missing required fields: clinic_id, email, plan_or_pack_id" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (!LEMONSQUEEZY_API_KEY) {
            console.error("LEMONSQUEEZY_API_KEY is not configured");
            return new Response(
                JSON.stringify({ error: "Server configuration error: Missing LemonSqueezy API key" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Resolve the variant ID
        const variantId = VARIANT_IDS[plan_or_pack_id];
        if (!variantId || variantId.startsWith("PLACEHOLDER")) {
            console.error(`Variant ID not configured for: ${plan_or_pack_id}`);
            return new Response(
                JSON.stringify({ error: `Product variant not configured: ${plan_or_pack_id}. Please configure LS_VARIANT_* secrets.` }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Determine credits metadata for credit packs
        const creditsMap: Record<string, number> = {
            'pack_500': 500, 'pack_1500': 1500, 'pack_4000': 4000,
            'pack_500_4o': 500, 'pack_1500_4o': 1500, 'pack_4000_4o': 4000,
        };

        // Build custom_data for webhook processing
        const customData: Record<string, string> = {
            clinic_id: clinic_id,
            type: type,
        };

        if (type === 'ai_credits') {
            customData.credits = String(creditsMap[plan_or_pack_id] || 0);
            customData.model = model || 'mini';
        } else {
            customData.plan = plan_or_pack_id;
        }

        // Build LemonSqueezy checkout payload (JSON:API format)
        const checkoutPayload = {
            data: {
                type: "checkouts",
                attributes: {
                    checkout_data: {
                        email: email,
                        custom: customData,
                    },
                    checkout_options: {
                        embed: false,
                        media: true,
                        logo: true,
                        desc: true,
                        discount: true,
                        locale: "es",
                    },
                    product_options: {
                        redirect_url: success_url || `${SUPABASE_URL.replace('.supabase.co', '')}/app/settings?payment=success`,
                    },
                },
                relationships: {
                    store: {
                        data: {
                            type: "stores",
                            id: LEMONSQUEEZY_STORE_ID,
                        },
                    },
                    variant: {
                        data: {
                            type: "variants",
                            id: variantId,
                        },
                    },
                },
            },
        };

        console.log(`Creating LemonSqueezy checkout: clinic=${clinic_id}, type=${type}, variant=${variantId}`);

        // Call LemonSqueezy API
        const lsResponse = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
            method: "POST",
            headers: {
                "Accept": "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json",
                "Authorization": `Bearer ${LEMONSQUEEZY_API_KEY}`,
            },
            body: JSON.stringify(checkoutPayload),
        });

        if (!lsResponse.ok) {
            const errorData = await lsResponse.json();
            console.error("LemonSqueezy API error:", JSON.stringify(errorData));
            return new Response(
                JSON.stringify({ error: "Failed to create checkout", details: errorData }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const lsData = await lsResponse.json();
        const checkoutUrl = lsData.data?.attributes?.url;

        if (!checkoutUrl) {
            console.error("No checkout URL returned:", lsData);
            return new Response(
                JSON.stringify({ error: "No checkout URL returned from LemonSqueezy" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        console.log(`Checkout created successfully: ${checkoutUrl}`);

        return new Response(
            JSON.stringify({
                url: checkoutUrl,
                checkout_id: lsData.data?.id,
            }),
            {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    } catch (error: any) {
        console.error("Internal error:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error", message: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
