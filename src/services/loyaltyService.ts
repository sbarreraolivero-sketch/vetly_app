import { supabase } from '@/lib/supabase'

export interface LoyaltyStats {
    total_points: number
    active_points: number
    redeemed_points: number
    referral_count: number
    referral_earnings: number
}

export interface LoyaltyTransaction {
    id: string
    tutor_id: string
    type: 'earn' | 'redeem' | 'adjustment' | 'referral_bonus'
    points: number
    description: string
    created_at: string
}

export interface LoyaltySettings {
    loyalty_enabled: boolean
    loyalty_points_percentage: number
    loyalty_referral_bonus: number
    loyalty_welcome_bonus: number
    loyalty_program_mode: 'points' | 'money' | 'percentage'
    loyalty_points_name: string
    loyalty_currency_symbol: string
}

export interface LoyaltyReward {
    id: string
    clinic_id: string
    name: string
    description: string
    points_cost: number
    reward_type: 'points' | 'money' | 'percentage' | 'gift' | 'treatment'
    reward_value: number
    is_active: boolean
}

export const loyaltyService = {
    // Get stats for a tutor
    async getTutorLoyalty(tutorId: string) {
        const { data, error } = await supabase
            .from('tutors')
            .select('loyalty_points, referral_code, referral_count')
            .eq('id', tutorId)
            .single()
        if (error) throw error
        return data
    },

    // Get transactions for a tutor
    async getTransactions(tutorId: string): Promise<LoyaltyTransaction[]> {
        const { data, error } = await supabase
            .from('loyalty_transactions')
            .select('*')
            .eq('tutor_id', tutorId)
            .order('created_at', { ascending: false })
        if (error) throw error
        return data as LoyaltyTransaction[]
    },

    // Add or Remove points (Adjustment)
    async adjustPoints(clinicId: string, tutorId: string, points: number, description: string) {
        const { error: txError } = await (supabase as any)
            .from('loyalty_transactions')
            .insert({
                clinic_id: clinicId,
                tutor_id: tutorId,
                type: 'adjustment',
                points: points,
                description: description
            })
        if (txError) throw txError
    },

    // Get clinic settings for loyalty
    async getSettings(clinicId: string): Promise<LoyaltySettings> {
        const { data, error } = await supabase
            .from('clinic_settings')
            .select('loyalty_enabled, loyalty_points_percentage, loyalty_referral_bonus, loyalty_welcome_bonus, loyalty_program_mode, loyalty_points_name, loyalty_currency_symbol')
            .eq('id', clinicId)
            .single()
        if (error) throw error
        return data as LoyaltySettings
    },

    // Rewards Catalog management
    async getRewards(clinicId: string): Promise<LoyaltyReward[]> {
        const { data, error } = await supabase
            .from('loyalty_rewards')
            .select('*')
            .eq('clinic_id', clinicId)
            .order('points_cost', { ascending: true })
        if (error) throw error
        return data as LoyaltyReward[]
    },

    async createReward(reward: Omit<LoyaltyReward, 'id' | 'is_active'>) {
        const { error } = await (supabase as any)
            .from('loyalty_rewards')
            .insert(reward)
        if (error) throw error
    },

    // Update loyalty settings
    async updateSettings(clinicId: string, settings: Partial<LoyaltySettings>) {
        const { error } = await (supabase as any)
            .from('clinic_settings')
            .update(settings)
            .eq('id', clinicId)
        if (error) throw error
    },

    // Generate WhatsApp message with variables for points
    // This is a helper for the trigger logic
    formatLoyaltyMessage(template: string, tutorName: string, points: number, treatment?: string) {
        // Simple client-side preview, actual replacement happens in Supabase Edge Function
        return template
            .replace('{{1}}', tutorName)
            .replace('{{7}}', points.toString())
            .replace('{{4}}', treatment || 'tu tratamiento')
    }
}
