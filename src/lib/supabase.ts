import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('CRITICAL: Supabase keys are missing! Check your environment variables.')
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit',
    },
})

// Helper functions for common queries
export async function getClinicSettings() {
    const { data, error } = await supabase
        .from('clinic_settings')
        .select('*')
        .single()

    if (error) throw error
    return data
}

export async function getAppointments(status?: string) {
    let query = supabase
        .from('appointments')
        .select('*')
        .order('appointment_date', { ascending: true })

    if (status) {
        query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) throw error
    return data
}

export async function getMessages(phoneNumber?: string, limit = 50) {
    let query = supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)

    if (phoneNumber) {
        query = query.eq('phone_number', phoneNumber)
    }

    const { data, error } = await query
    if (error) throw error
    return data
}

interface MessageRow {
    phone_number: string
    content: string
    created_at: string
}

export async function getConversations() {
    // Get unique phone numbers with latest message
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
        .from('messages')
        .select('phone_number, content, created_at')
        .order('created_at', { ascending: false })

    if (error) throw error

    // Group by phone number and get latest message
    const conversations = new Map<string, { phone_number: string; last_message: string; last_message_at: string }>()

    if (data) {
        for (const msg of data as MessageRow[]) {
            if (!conversations.has(msg.phone_number)) {
                conversations.set(msg.phone_number, {
                    phone_number: msg.phone_number,
                    last_message: msg.content,
                    last_message_at: msg.created_at,
                })
            }
        }
    }

    return Array.from(conversations.values())
}
