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

// El candado de sesión (navigator.locks) puede ser "robado" por otra pestaña y lanzar
// AbortError antes de llegar al servidor, por lo que reintentar es seguro.
export function isAuthLockError(err: unknown): boolean {
    const e = err as { name?: string; message?: string } | null
    const msg = `${e?.name ?? ''} ${e?.message ?? ''}`
    return /lock broken|steal|not released within/i.test(msg)
}

export async function withAuthLockRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            const result = await fn() as T & { error?: unknown }
            if (result && result.error && isAuthLockError(result.error) && attempt < retries) {
                await new Promise(r => setTimeout(r, 300 * (attempt + 1)))
                continue
            }
            return result
        } catch (err) {
            if (!isAuthLockError(err) || attempt >= retries) throw err
            await new Promise(r => setTimeout(r, 300 * (attempt + 1)))
        }
    }
}

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

/**
 * supabase-js NO lanza cuando una escritura falla: devuelve `{ error }`.
 * Un `try { await supabase.from(...).delete() } catch {}` nunca captura nada
 * y la UI muestra el cambio como guardado aunque no lo esté. Envolver las
 * escrituras con `assertOk(await ...)` para que el error llegue al catch.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function assertOk<T extends { error: any }>(res: T): T {
    if (res.error) throw res.error
    return res
}
