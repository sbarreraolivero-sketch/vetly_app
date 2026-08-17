// User Signup Handler Edge Function
// Creates user, clinic, profile, and subscription in a single transaction
// Uses service_role to bypass RLS for initial setup

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { limitsForPlan } from "../_shared/planLimits.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MERCADOPAGO_ACCESS_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || "";

// CORS headers for Supabase client
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SignupRequest {
    email: string;
    password: string;
    full_name: string;
    clinic_name: string;
    selected_plan?: string;
    card_token?: string;
    payment_provider?: 'mercadopago' | 'paddle';
    referral_code?: string;
}

Deno.serve(async (req: Request) => {
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
        const body: SignupRequest = await req.json();
        const { email, password, full_name, clinic_name, selected_plan = "starter", card_token, payment_provider = 'mercadopago', referral_code } = body;

        // Validate required fields
        if (!email || !password || !full_name || !clinic_name) {
            return new Response(
                JSON.stringify({ error: "Missing required fields" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Validate password length
        if (password.length < 6) {
            return new Response(
                JSON.stringify({ error: "Password must be at least 6 characters" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // --- MERCADO PAGO INTEGRATION ---
        let mpCustomerId: string | null = null;
        let mpCardId: string | null = null;

        if (card_token && MERCADOPAGO_ACCESS_TOKEN) {
            try {
                // 1. Search for existing customer
                const searchRes = await fetch(`https://api.mercadopago.com/v1/customers/search?email=${email}`, {
                    headers: { "Authorization": `Bearer ${MERCADOPAGO_ACCESS_TOKEN}` }
                });
                const searchData = await searchRes.json();

                if (searchData.results && searchData.results.length > 0) {
                    mpCustomerId = searchData.results[0].id;
                } else {
                    // 2. Create customer
                    const createRes = await fetch(`https://api.mercadopago.com/v1/customers`, {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ email })
                    });
                    const resText = await createRes.text();
                    console.error("Mercado Pago creation failed! Status:", createRes.status, "Response:", resText);
                    const createData = JSON.parse(resText);
                    if (createData.id) {
                        mpCustomerId = createData.id;
                    } else {
                        throw new Error(`Failed to create Mercado Pago customer: ${createData.message || resText}`);
                    }
                }

                // 3. Attach card
                if (mpCustomerId) {
                    const cardRes = await fetch(`https://api.mercadopago.com/v1/customers/${mpCustomerId}/cards`, {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ token: card_token })
                    });
                    const cardData = await cardRes.json();
                    if (cardData.id) {
                        mpCardId = cardData.id;
                    } else {
                        throw new Error(cardData.message || "Failed to save card");
                    }
                }
            } catch (error) {
                console.warn("Mercado Pago error (Proceeding anyway):", error);
                // We log the error but don't block the user from joining.
                // Billing status will remain 'none' in the database.
            }
        }
        // ---------------------------------

        // Create admin client with service role
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });

        // 1. Create auth user with auto-confirm
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true, // Auto-confirm email for smooth onboarding
            user_metadata: {
                full_name,
            },
        });

        if (authError) {
            console.error("Auth error:", authError);

            // Handle duplicate email
            if (authError.message?.includes("already registered") || authError.message?.includes("already been registered")) {
                return new Response(
                    JSON.stringify({ error: "Este email ya está registrado" }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            return new Response(
                JSON.stringify({ error: authError.message }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (!authData.user) {
            return new Response(
                JSON.stringify({ error: "Failed to create user" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const userId = authData.user.id;

        // Límites desde la tabla `plan_limits` (ver _shared/planLimits.ts).
        // Antes esto era un CASE que solo entendía IDs legacy: con los planes
        // actuales (core/starter/pro/enterprise) toda cuenta nueva caía al
        // fallback de 1000 créditos y 2 usuarios, sin importar lo que pagara.
        const planLimits = await limitsForPlan(supabaseAdmin, selected_plan);

        // Core es la puerta de entrada sin agente IA — entra directo al dashboard
        // (sin la pantalla de "agenda tu activación") y tiene 30 días de prueba
        // en vez de los 7 estándar, para dar tiempo real a evaluar el resto del
        // sistema (finanzas, inventario, fidelización) sin la ayuda del agente.
        const isCorePlan = selected_plan === "core";
        const trialDays = isCorePlan ? 30 : 7;
        const now = new Date();
        const trialEndDate = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

        // 2. Create clinic
        const { data: clinicData, error: clinicError } = await supabaseAdmin
            .from("clinic_settings")
            .insert({
                clinic_name: clinic_name,
                subscription_plan: selected_plan,
                ai_credits_monthly_limit: planLimits.ai_credits,
                ai_credits_monthly_4o_limit: planLimits.ai_credits > 0 ? 999999 : 0,
                max_users: planLimits.max_users,
                services: [
                    { id: "svc-1", name: "Consulta General", duration: 30, price: 500 },
                ],
                payment_provider: payment_provider,
                mercadopago_customer_id: mpCustomerId,
                mercadopago_card_id: mpCardId,
                activation_status: isCorePlan ? 'active' : 'pending_activation',
                billing_status: (mpCardId || payment_provider === 'paddle') ? 'card_verified' : 'none',
                trial_start_date: now.toISOString(),
                trial_end_date: trialEndDate.toISOString(),
                trial_status: 'running',
            })
            .select()
            .single();

        if (clinicError) {
            console.error("Clinic error:", clinicError);
            // Rollback: delete the auth user
            await supabaseAdmin.auth.admin.deleteUser(userId);
            return new Response(
                JSON.stringify({ error: "Error creating clinic" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 3. Create user profile
        const { error: profileError } = await supabaseAdmin
            .from("user_profiles")
            .insert({
                id: userId,
                email: email,
                full_name: full_name,
                clinic_id: clinicData.id,
                role: "owner",
            });

        if (profileError) {
            console.error("Profile error:", profileError);
            // Rollback
            await supabaseAdmin.from("clinic_settings").delete().eq("id", clinicData.id);
            await supabaseAdmin.auth.admin.deleteUser(userId);
            return new Response(
                JSON.stringify({ error: "Error creating profile" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 4. Insert into clinic_members (Fix: Ensure user is Owner)
        const { error: memberError } = await supabaseAdmin
            .from("clinic_members")
            .insert({
                clinic_id: clinicData.id,
                user_id: userId,
                email: email,
                role: "owner",
                status: "active",
                first_name: full_name.split(' ')[0]
            });

        if (memberError) {
            console.error("Member error:", memberError);
            // Rollback everything
            await supabaseAdmin.from("user_profiles").delete().eq("id", userId);
            await supabaseAdmin.from("clinic_settings").delete().eq("id", clinicData.id);
            await supabaseAdmin.auth.admin.deleteUser(userId);
            return new Response(
                JSON.stringify({ error: "Error adding member to clinic" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 4b. Referral B2B capture (non-fatal — never blocks signup)
        if (referral_code) {
            try {
                const { data: referrer } = await supabaseAdmin
                    .from("clinic_settings")
                    .select("id")
                    .eq("partner_referral_code", referral_code.toUpperCase())
                    .maybeSingle();

                if (referrer && referrer.id !== clinicData.id) {
                    const { error: referralError } = await supabaseAdmin
                        .from("clinic_referrals")
                        .insert({
                            referrer_clinic_id: referrer.id,
                            referred_clinic_id: clinicData.id,
                            referral_code: referral_code.toUpperCase(),
                            referred_plan: selected_plan,
                        });
                    if (referralError) console.warn("Referral capture insert failed (non-fatal):", referralError);
                }
            } catch (e) {
                console.warn("Referral capture failed (non-fatal):", e);
            }
        }

        // 5. Send Welcome Email (Async)
        try {
            fetch(`${SUPABASE_URL}/functions/v1/send-welcome-email`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                },
                body: JSON.stringify({
                    email,
                    full_name,
                    clinic_name
                })
            }).catch(err => console.error("Error triggering welcome email:", err));
        } catch (e) {
            console.warn("Welcome email trigger failed (skipping):", e);
        }

        // Note: Subscription is auto-created by trigger on clinic_settings insert.
        // The trigger may use a default plan, so we must explicitly update it to the selected plan.
        const { error: subPlanError } = await supabaseAdmin
            .from('subscriptions')
            .update({ plan_id: selected_plan })
            .eq('clinic_id', clinicData.id)

        if (subPlanError) {
            // Non-fatal: log but don't fail the signup
            console.warn('Could not sync subscription plan from trigger:', subPlanError)
        }

        // Return success
        return new Response(
            JSON.stringify({
                success: true,
                user_id: userId,
                clinic_id: clinicData.id,
                message: "Account created successfully",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error("Signup error:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
