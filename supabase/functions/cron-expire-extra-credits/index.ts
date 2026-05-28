import { createClient } from "npm:@supabase/supabase-js@2"

Deno.serve(async () => {
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    const now = new Date().toISOString()

    const { data: expired, error } = await supabase
        .from('clinic_settings')
        .select('id, clinic_name, ai_credits_extra_balance, ai_credits_extra_4o')
        .or('ai_credits_extra_balance.gt.0,ai_credits_extra_4o.gt.0')
        .not('ai_credits_extra_expires_at', 'is', null)
        .lt('ai_credits_extra_expires_at', now)

    if (error) {
        console.error('[expire-credits] Error fetching expired clinics:', error)
        return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    }

    let processed = 0
    for (const clinic of (expired || [])) {
        const expiredAmount = (clinic.ai_credits_extra_balance || 0) + (clinic.ai_credits_extra_4o || 0)
        if (expiredAmount <= 0) continue

        const { error: updateErr } = await supabase
            .from('clinic_settings')
            .update({
                ai_credits_extra_balance: 0,
                ai_credits_extra_4o: 0,
                ai_credits_extra_expires_at: null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', clinic.id)

        if (updateErr) {
            console.error(`[expire-credits] Error updating clinic ${clinic.id}:`, updateErr)
            continue
        }

        await supabase.from('ai_credit_transactions').insert({
            clinic_id: clinic.id,
            type: 'adjustment',
            amount: -expiredAmount,
            balance_after: 0,
            description: 'Expiración de créditos extra (30 días cumplidos)',
            metadata: { expired_at: now, mini_expired: clinic.ai_credits_extra_balance || 0, four_o_expired: clinic.ai_credits_extra_4o || 0 }
        })

        console.log(`[expire-credits] Expired ${expiredAmount} credits for ${clinic.clinic_name || clinic.id}`)
        processed++
    }

    return new Response(JSON.stringify({ expired: processed, checked: expired?.length ?? 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    })
})
