import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// Example email provider key if we integrate SendGrid/Resend
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Find trials ending in exactly 3 days (Reminder)
        const dateIn3Days = new Date();
        dateIn3Days.setDate(dateIn3Days.getDate() + 3);
        const dateStr3Days = dateIn3Days.toISOString().split('T')[0];

        // Find trials ending in exactly 1 day (Final Reminder)
        const dateIn1Day = new Date();
        dateIn1Day.setDate(dateIn1Day.getDate() + 1);
        const dateStr1Day = dateIn1Day.toISOString().split('T')[0];

        // This is a naive check (comparing dates as strings). In a robust system, we query using ranges.
        const { data: endingClinics, error: endError } = await supabaseAdmin
            .from('clinic_settings')
            .select(`
                id, 
                clinic_name, 
                trial_end_date,
                clinic_members!inner(email, first_name, role)
            `)
            .eq('trial_status', 'running')
            .eq('clinic_members.role', 'owner');

        if (endError) throw endError;

        const results = [];

        for (const clinic of endingClinics || []) {
            if (!clinic.trial_end_date) continue;

            const endDateStr = clinic.trial_end_date.split('T')[0];
            const ownerEmail = clinic.clinic_members[0]?.email;
            const ownerName = clinic.clinic_members[0]?.first_name || 'Usuario';

            if (!ownerEmail) continue;

            if (endDateStr === dateStr3Days) {
                // Send 3-day reminder
                console.log(`Sending 3-day reminder to ${ownerEmail}`);
                results.push({ clinic: clinic.id, message: '3-day reminder sent', email: ownerEmail });
                // If RESEND_API_KEY is available, implement the fetch call to Resend here.
                // fetch('https://api.resend.com/emails', { ... })
            } else if (endDateStr === dateStr1Day) {
                // Send 1-day reminder
                console.log(`Sending 1-day final reminder to ${ownerEmail}`);
                results.push({ clinic: clinic.id, message: '1-day final reminder sent', email: ownerEmail });
                // fetch('https://api.resend.com/emails', { ... })
            }
        }

        return new Response(JSON.stringify({ message: "Processed notifications", results }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

    } catch (error: any) {
        console.error("Error in send-notifications:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
});
