// Paddle Create Transaction - Edge Function
// Crea una transacción draft con precio no-catálogo para compras de monto variable
// (recordatorios por unidad, créditos de campaña). El frontend abre el checkout de
// Paddle.js pasando el transaction_id devuelto — no hay redirect, es overlay.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PADDLE_API_KEY = Deno.env.get("PADDLE_API_KEY") || "";
const PADDLE_ENVIRONMENT = Deno.env.get("PADDLE_ENVIRONMENT") || "sandbox";
const PADDLE_API_HOST = PADDLE_ENVIRONMENT === "production"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

// Producto "contenedor" para precios no-catálogo — sin precio fijo propio,
// solo sirve como product_id requerido por la API de Paddle. Creado una vez
// en el catálogo (sandbox y live) junto con los packs fijos.
const PADDLE_CONTAINER_PRODUCT_ID = Deno.env.get("PADDLE_CONTAINER_PRODUCT_ID") || "";

interface RequestBody {
    clinic_id: string;
    type: "reminders" | "campaign_credits";
    quantity: number;
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
        const { clinic_id, type, quantity } = body;

        if (!clinic_id || !type || !quantity) {
            return new Response(
                JSON.stringify({ error: "Missing required fields: clinic_id, type, quantity" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Verificar que quien llama sea miembro activo de `clinic_id` -- hallazgo de
        // seguridad de sesión 86: sin esto, cualquier cuenta autenticada podía pasar
        // el UUID de otra clínica y, al pagar, acreditarle créditos de campaña o
        // recordatorios a una clínica ajena vía custom_data.clinic_id. Mismo patrón
        // que mercadopago-create-subscription.
        const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
        if (!jwt) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }
        const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: `Bearer ${jwt}` } },
        });
        const { data: { user } } = await sbUser.auth.getUser();
        if (!user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: member } = await supabase
            .from("clinic_members")
            .select("id")
            .eq("user_id", user.id)
            .eq("clinic_id", clinic_id)
            .eq("status", "active")
            .maybeSingle();
        if (!member) {
            return new Response(JSON.stringify({ error: "Forbidden" }), {
                status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        if (!PADDLE_API_KEY || !PADDLE_CONTAINER_PRODUCT_ID) {
            console.error("PADDLE_API_KEY or PADDLE_CONTAINER_PRODUCT_ID not configured");
            return new Response(
                JSON.stringify({ error: "Server configuration error: Missing Paddle credentials" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Precio SIEMPRE calculado server-side — nunca confiar en un monto del frontend.
        // Misma lógica que hoy en lemonsqueezy-create-checkout: $0.15/unidad en ambos tipos,
        // redondeo a múltiplos de 10, con distinto mínimo por tipo.
        let roundedQuantity: number;
        let description: string;

        if (type === "reminders") {
            const units = Math.max(10, quantity);
            roundedQuantity = Math.ceil(units / 10) * 10;
            description = "Recordatorios por unidad";
        } else if (type === "campaign_credits") {
            const credits = Math.max(50, quantity);
            roundedQuantity = Math.ceil(credits / 10) * 10;
            description = "Créditos de campaña";
        } else {
            return new Response(
                JSON.stringify({ error: `Invalid type: ${type}` }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const unitPriceCents = roundedQuantity * 15; // US$0.15/unidad = 15 centavos

        const transactionPayload = {
            items: [
                {
                    price: {
                        description,
                        product_id: PADDLE_CONTAINER_PRODUCT_ID,
                        unit_price: { amount: String(unitPriceCents), currency_code: "USD" },
                        tax_mode: "account_setting",
                    },
                    quantity: 1,
                },
            ],
            custom_data: {
                clinic_id,
                type,
                quantity: String(roundedQuantity),
            },
        };

        console.log(`Creating Paddle draft transaction: clinic=${clinic_id}, type=${type}, quantity=${roundedQuantity}`);

        const paddleResponse = await fetch(`${PADDLE_API_HOST}/transactions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${PADDLE_API_KEY}`,
            },
            body: JSON.stringify(transactionPayload),
        });

        if (!paddleResponse.ok) {
            const errorText = await paddleResponse.text();
            console.error(`Paddle API error (${paddleResponse.status}):`, errorText);
            // Devuelve 200 para que el frontend pueda leer el error via data.details
            return new Response(
                JSON.stringify({ success: false, error: `Error de Paddle (${paddleResponse.status})`, details: errorText }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const paddleData = await paddleResponse.json();
        const transactionId = paddleData.data?.id;

        if (!transactionId) {
            console.error("No transaction id returned:", paddleData);
            return new Response(
                JSON.stringify({ error: "No transaction id returned from Paddle" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        console.log(`Draft transaction created successfully: ${transactionId}`);

        return new Response(
            JSON.stringify({ transaction_id: transactionId }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error: any) {
        console.error("Internal error:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
