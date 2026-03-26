
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        console.log("Starting cron-retention-compute...")

        // 1. Get all active clinics (from subscription or simply list clinic_settings)
        // Optimization: only process clinics with active subscriptions (Radiance/Prestige).
        // But for MVP, let's process all clinics to show "at risk" analysis even for Essence users (just no actions).
        // Wait, actions only for Radiance+.
        // The `generate_retention_actions` RPC should probably check plan?
        // Or we filter here.

        // Let's fetch clinics and iterate.
        const { data: clinics, error: clinicsError } = await supabaseClient
            .from('clinic_settings')
            .select('id, clinic_name')

        if (clinicsError) throw clinicsError

        console.log(`Processing ${clinics?.length || 0} clinics...`)

        const results = []

        for (const clinic of (clinics || [])) {
            try {
                // 2. Compute Scores
                const { data: scoreCount, error: scoreError } = await supabaseClient
                    .rpc('compute_clinic_retention_scores', { p_clinic_id: clinic.id })

                if (scoreError) throw scoreError

                // 3. Generate Actions based on protocols
                // Only if plan supports it? 
                // Let's assume the RPC handles logic or simply generates actions that stay "pending" if not autonomous.
                const { data: actionCount, error: actionError } = await supabaseClient
                    .rpc('generate_retention_actions', { p_clinic_id: clinic.id })

                if (actionError) throw actionError

                results.push({
                    clinic: clinic.clinic_name,
                    scores_computed: scoreCount,
                    actions_generated: actionCount
                })

            } catch (err) {
                console.error(`Error processing clinic ${clinic.clinic_name}:`, err)
                results.push({ clinic: clinic.clinic_name, error: err.message })
            }
        }

        return new Response(
            JSON.stringify({ success: true, processed: results }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
    }
})
