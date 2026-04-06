
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { email, password, fullName, jobTitle, clinicId } = await req.json();

        // 1. Create admin client
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 2. Validate invite exists and is pending
        const { data: invite, error: inviteError } = await supabaseAdmin
            .from('clinic_members')
            .select('id, status')
            .eq('email', email)
            .eq('status', 'invited')
            .maybeSingle();

        if (inviteError || !invite) {
            return new Response(JSON.stringify({ error: "No se encontró una invitación válida para este correo." }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // 3. Create OR Update User (Auto-confirm)
        // We use admin.createUser to avoid confirmation email friction
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                full_name: fullName,
                job_title: jobTitle
            }
        });

        let userId = authData.user?.id;

        if (authError) {
            // If user already exists, we try to update them instead (to handle retries or previous accounts)
            if (authError.message.includes("already registered")) {
                // Try to get user id by email
                const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();
                const existingUser = users.users.find(u => u.email === email);
                
                if (existingUser) {
                    userId = existingUser.id;
                    // Update password and confirm
                    await supabaseAdmin.auth.admin.updateUserById(userId, {
                        password: password,
                        email_confirm: true,
                        user_metadata: {
                            full_name: fullName,
                            job_title: jobTitle
                        }
                    });
                } else {
                    throw authError;
                }
            } else {
                throw authError;
            }
        }

        // 4. Link Member
        const { error: linkError } = await supabaseAdmin
            .from('clinic_members')
            .update({
                user_id: userId,
                status: 'active',
                first_name: fullName.split(' ')[0],
                job_title: jobTitle
            })
            .eq('email', email)
            .eq('status', 'invited');

        if (linkError) throw linkError;

        // 5. Create Profile (if missing)
        await supabaseAdmin
            .from('user_profiles')
            .upsert({
                id: userId,
                email: email,
                full_name: fullName,
                clinic_id: clinicId,
                role: 'professional' // Default role for search profile
            }, { onConflict: 'id' });

        return new Response(JSON.stringify({ success: true, userId }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Join Handler Error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
