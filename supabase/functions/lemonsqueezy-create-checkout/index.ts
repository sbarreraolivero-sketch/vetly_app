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
    // Subscription Plans (current IDs)
    'core':       Deno.env.get("LS_VARIANT_CORE")       || "1696093",
    'starter':    Deno.env.get("LS_VARIANT_STARTER")    || "1459505",
    'pro':        Deno.env.get("LS_VARIANT_PRO")        || "1459526",
    'enterprise': Deno.env.get("LS_VARIANT_ENTERPRISE") || "1459528",
    // Legacy plan IDs — backward compat for existing subscriptions in DB
    'essence':    Deno.env.get("LS_VARIANT_STARTER")    || "1459505",
    'radiance':   Deno.env.get("LS_VARIANT_PRO")        || "1459526",
    'prestige':   Deno.env.get("LS_VARIANT_ENTERPRISE") || "1459528",
    // AI Credit Packs (mini)
    'pack_500':    Deno.env.get("LS_VARIANT_PACK_500")   || "1696070",
    'pack_1500':   Deno.env.get("LS_VARIANT_PACK_1500")  || "1696077",
    'pack_4000':   Deno.env.get("LS_VARIANT_PACK_4000")  || "1696079",
    // AI Credit Packs (4o premium)
    'pack_500_4o':  Deno.env.get("LS_VARIANT_PACK_500_4O")  || "1459861",
    'pack_1500_4o': Deno.env.get("LS_VARIANT_PACK_1500_4O") || "1459869",
    'pack_4000_4o': Deno.env.get("LS_VARIANT_PACK_4000_4O") || "1459872",
    // Reminder Units — per-unit purchase ($1.50 USD / 10 units, min 20 units)
    'reminders': Deno.env.get("LS_VARIANT_REMINDERS") || "PLACEHOLDER_REMINDERS",
    // Reminder Packs — fixed-quantity bundles
    'reminders_50':        Deno.env.get("LS_VARIANT_REMINDERS_50")        || "1701015",
    'reminders_350':       Deno.env.get("LS_VARIANT_REMINDERS_350")       || "1701021",
    'reminders_unlimited': Deno.env.get("LS_VARIANT_REMINDERS_UNLIMITED") || "1701025",
};

interface RequestBody {
    clinic_id: string;
    email: string;
    type: 'subscription' | 'ai_credits' | 'reminders';
    plan_or_pack_id: string;  // e.g. 'essence', 'pack_500', 'reminders'
    model?: 'mini' | '4o';    // for ai_credits only
    quantity?: number;         // for reminders: units to purchase (min 20)
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
        const { clinic_id, email, type, plan_or_pack_id, model, quantity, success_url } = body;

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

        // Fixed quantities for reminder packs (9999 = effectively unlimited for the month)
        const reminderPackQtyMap: Record<string, number> = {
            'reminders_50': 50, 'reminders_350': 350, 'reminders_unlimited': 9999,
        };

        // lsQuantity: quantity to pass to LS checkout (packs of 10 for individual units)
        let lsQuantity: number | undefined;

        if (type === 'ai_credits') {
            customData.credits = String(creditsMap[plan_or_pack_id] || 0);
            customData.model = model || 'mini';
        } else if (type === 'reminders') {
            const fixedQty = reminderPackQtyMap[plan_or_pack_id];
            if (fixedQty !== undefined) {
                customData.quantity = String(fixedQty);
            } else {
                // Individual units: LS variant = $1.50 per 10 units (LS minimum $0.50/variant)
                // customData.quantity = actual reminders to credit in DB
                // lsQuantity         = what LS charges for (packs of 10)
                const units = Math.max(20, quantity || 20);
                const roundedUnits = Math.ceil(units / 10) * 10;
                customData.quantity = String(roundedUnits);
                lsQuantity = roundedUnits / 10;
            }
        } else {
            customData.plan = plan_or_pack_id;
        }

        // Build LemonSqueezy checkout payload (JSON:API format)
        const checkoutData: Record<string, unknown> = {
            email: email,
            custom: customData,
        };
        if (lsQuantity !== undefined) {
            checkoutData.quantity = lsQuantity;
        }

        const checkoutPayload = {
            data: {
                type: "checkouts",
                attributes: {
                    checkout_data: checkoutData,
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
