
import { supabase } from '@/lib/supabase'

export type UserRole = 'owner' | 'admin' | 'professional' | 'receptionist' | 'vet_assistant'
export type MemberStatus = 'active' | 'invited' | 'disabled'

export interface ClinicMember {
    id: string
    clinic_id: string
    user_id: string | null
    email: string
    role: UserRole
    status: MemberStatus
    first_name?: string
    last_name?: string
    specialty?: string
    color?: string
    job_title?: string
    working_hours?: Record<string, { enabled: boolean; start: string; end: string }>
    created_at: string
}

export const teamService = {
    async getMembers(clinicId: string) {
        // Use RPC to bypass potential RLS issues and ensure consistent data access
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('get_clinic_members_secure', {
            p_clinic_id: clinicId
        })

        if (error) {
            console.error('Error fetching members via RPC:', error)
            throw error
        }

        return data as ClinicMember[]
    },

    async inviteMember(clinicId: string, email: string, role: UserRole, firstName?: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('invite_member_v2', {
            p_clinic_id: clinicId,
            p_email: email,
            p_role: role,
            p_first_name: firstName
        })

        if (error) throw error

        // Trigger Send Email Edge Function
        try {
            const { data: settings } = await (supabase as any)
                .from('clinic_settings')
                .select('clinic_name')
                .eq('id', clinicId)
                .single()

            const clinicName = settings?.clinic_name || 'tu clínica'
            const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.Vetly AI.com'
            const inviteLink = `${origin}/register?mode=join&clinic=${clinicId}&email=${encodeURIComponent(email)}`

            await supabase.functions.invoke('send-invite-email', {
                body: {
                    email,
                    clinicName,
                    inviteLink,
                }
            })
        } catch (emailErr) {
            console.error('Error triggering invite email:', emailErr)
        }

        return data
    },

    async updateMember(id: string, updates: Partial<ClinicMember>) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.from('clinic_members') as any)
            .update(updates)
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data as ClinicMember
    },

    async deleteMember(id: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any).rpc('delete_clinic_member', {
            p_member_id: id
        })

        if (error) throw error
    },

    // Get current user's member profile
    async getCurrentMember() {
        try {
            // Use RPC to bypass potential RLS complexity and ensure correct retrieval
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase as any).rpc('get_myself_clinical_member')

            if (error) {
                console.error('Error fetching member via RPC:', error)
                return null
            }

            return data as ClinicMember | null
        } catch (err) {
            console.error('getCurrentMember exception:', err)
            return null
        }
    },

    async getClinicSettings(clinicId: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('get_clinic_settings_secure', {
            p_clinic_id: clinicId
        })

        if (error) {
            console.error('Error fetching settings via RPC:', error)
            throw error
        }

        // RPC returns array (SETOF), take first
        return data && data.length > 0 ? data[0] : null
    },

    async createBranch(name: string, address?: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('create_clinic_branch', {
            p_name: name,
            p_address: address || null
        })

        if (error) throw error
        return data
    },

    async getClinicProfessionals(clinicId: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc('get_clinic_professionals', {
            p_clinic_id: clinicId
        })

        if (error) throw error
        return data as ClinicMember[]
    },

    async updateMemberProfile(id: string, updates: {
        first_name?: string
        last_name?: string
        job_title?: string
        specialty?: string
        color?: string
        working_hours?: Record<string, { enabled: boolean; start: string; end: string }>
    }) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.from('clinic_members') as any)
            .update(updates)
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data as ClinicMember
    }
}
