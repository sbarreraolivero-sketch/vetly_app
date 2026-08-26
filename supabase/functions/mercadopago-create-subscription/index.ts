// Mercado Pago Subscription Creation Edge Function
// Deploy with: supabase functions deploy mercadopago-create-subscription

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { limitsForPlan } from "../_shared/planLimits.ts";

const MERCADOPAGO_ACCESS_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Plan prices in various currencies.
// core/starter/pro/enterprise son los IDs reales desde sesión 11 (mayo 2026).
// essence/radiance/prestige quedan como alias — no se puede garantizar que
// ningún llamador externo/histórico siga mandando el nombre legacy.
const PLAN_PRICES: Record<string, Record<string, number>> = {
    // ⚠️ Core está a PRECIO DE LANZAMIENTO. El precio de lista es CLP 33.000 /
    // USD 39; lo que se cobra hoy es 17.000 / 17.
    //
    // Paddle lo resuelve con un cupón sobre el precio de lista y un tope de 100
    // usos. MercadoPago no soporta cupones en suscripciones, así que acá el
    // precio de lanzamiento ES el monto recurrente — sin tope automático y sin
    // ancla visible del precio de lista (esa vive sólo en la UI).
    //
    // Para terminar la promo hay que subir estos números Y quitar `launchPrice`
    // de PLANS.core en src/lib/mercadopago.ts. Si se cambia sólo uno, la web
    // promete un precio distinto al que cobra el checkout.
    core: {
        CLP: 17000,
        USD: 17,
    },
    starter: {
        CLP: 92000,
        ARS: 99000,
        MXN: 1400,
        COP: 310000,
        PEN: 300,
        USD: 89,
    },
    pro: {
        CLP: 159000,
        ARS: 159000,
        MXN: 2800,
        COP: 620000,
        PEN: 600,
        USD: 169,
    },
    // $333.000 CLP — valor corregido en sesión 23 de CLAUDE.md. Mantener en
    // sync con src/lib/mercadopago.ts (PLANS.enterprise.price).
    enterprise: {
        CLP: 333000,
        ARS: 299000,
        MXN: 5200,
        COP: 1170000,
        PEN: 1120,
        USD: 349,
    },
};
PLAN_PRICES.essence = PLAN_PRICES.starter;
PLAN_PRICES.radiance = PLAN_PRICES.pro;
PLAN_PRICES.prestige = PLAN_PRICES.enterprise;

const PLAN_DESCRIPTIONS: Record<string, string> = {
    core: "Vetly - Plan Core (Gestión completa sin IA conversacional)",
    starter: "Vetly - Plan Starter (5 Usuarios + Agente IA WhatsApp)",
    pro: "Vetly - Plan Pro (10 Usuarios + IA ilimitada + Encuestas)",
    enterprise: "Vetly - Plan Enterprise (Usuarios Ilimitados + Multi-sucursal)",
};
PLAN_DESCRIPTIONS.essence = PLAN_DESCRIPTIONS.starter;
PLAN_DESCRIPTIONS.radiance = PLAN_DESCRIPTIONS.pro;
PLAN_DESCRIPTIONS.prestige = PLAN_DESCRIPTIONS.enterprise;

interface RequestBody {
    clinic_id: string;
    plan: "core" | "starter" | "pro" | "enterprise" | "essence" | "radiance" | "prestige";
    email: string;
    currency?: string;
    external_reference: string;
    back_urls: {
        success: string;
        failure: string;
        pending: string;
    };
}

// Los límites por plan vienen de la tabla `plan_limits` vía _shared/planLimits.ts.
// No declararlos inline aquí.

// Sin estos headers en TODA respuesta (incluidas las de error), el
// navegador bloquea la respuesta por CORS antes de que el JS del
// cliente llegue a verla -- supabase-js reporta un `error` genérico sin
// cuerpo, y cualquier fallo real de Mercado Pago (token, precio,
// parámetros) queda invisible detrás de un "Error al iniciar el pago"
// sin más detalle. Bug encontrado en sesión de billing, 2026-08-26.
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req: Request) => {
    // Handle CORS
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: CORS_HEADERS });
    }

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
    }

    try {
        const body: RequestBody = await req.json();
        const { clinic_id, plan, email, currency: reqCurrency, external_reference, back_urls } = body;

        // Validate required fields
        if (!clinic_id || !plan || !email) {
            return new Response(
                JSON.stringify({ error: "Missing required fields" }),
                { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
            );
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Verificar que quien llama sea miembro activo de `clinic_id` -- sin
        // esto, cualquier usuario autenticado de CUALQUIER clínica (incluida
        // una cuenta Core recién creada) podía pasar el UUID de otra clínica
        // y sobrescribirle plan_id/plan/status en `subscriptions` y max_users
        // en `clinic_settings` más abajo. verify_jwt=true solo confirma que
        // hay una sesión válida, no que sea dueño de ese clinic_id.
        const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
        if (!jwt) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            });
        }
        const sbUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
            global: { headers: { Authorization: `Bearer ${jwt}` } },
        });
        const { data: { user } } = await sbUser.auth.getUser();
        if (!user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            });
        }
        const { data: member } = await supabase
            .from("clinic_members")
            .select("id")
            .eq("user_id", user.id)
            .eq("clinic_id", clinic_id)
            .eq("status", "active")
            .maybeSingle();
        if (!member) {
            return new Response(JSON.stringify({ error: "Forbidden" }), {
                status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            });
        }

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
                { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
            );
        }

        const preference = await preferenceResponse.json();

        // Límites desde la tabla `plan_limits` (ver _shared/planLimits.ts).
        // Antes esto era un CASE inline que solo entendía IDs legacy: un plan
        // 'core' o 'starter' terminaba con max_agendas 1000 y max_users 999999.
        const planLimits = await limitsForPlan(supabase, plan);

        // Create pending subscription record in database
        await supabase.from("subscriptions").upsert({
            clinic_id: clinic_id,
            plan: plan,
            plan_id: plan,
            status: "trial",
            mercadopago_subscription_id: preference.id,
            // OJO: `trial_ends_at` NO existe en subscriptions — incluirla hacía
            // fallar el upsert entero. El trial real vive en
            // clinic_settings.trial_end_date.
            monthly_appointments_limit: null,
            max_agendas: planLimits.max_agendas,
            monthly_reminders_limit: planLimits.monthly_reminders,
            monthly_appointments_used: 0,
            monthly_reminders_used: 0,
            reminders_pack_balance: 0,
        }, {
            onConflict: "clinic_id",
        });

        // Sync max_users to clinic_settings
        await supabase.from("clinic_settings").update({
            max_users: planLimits.max_users
        }).eq("id", clinic_id);

        return new Response(
            JSON.stringify({
                id: preference.id,
                init_point: preference.init_point,
                sandbox_init_point: preference.sandbox_init_point,
            }),
            {
                headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
            }
        );
    } catch (error) {
        console.error("Error:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
    }
});
