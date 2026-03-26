import { useState, useEffect, createContext, useContext, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { User } from '@supabase/supabase-js'

interface AdminAuthContextType {
    adminUser: User | null
    isAdmin: boolean
    loading: boolean
    signOutAdmin: () => Promise<void>
}

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(undefined)

// Direct API call to bypass supabase-js AbortController issues
async function checkAdminDirect(userId: string, accessToken: string): Promise<boolean> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

    try {
        const response = await fetch(
            `${supabaseUrl}/rest/v1/platform_admins?id=eq.${userId}&select=id,role`,
            {
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
            }
        )

        if (!response.ok) return false
        const data = await response.json()
        return Array.isArray(data) && data.length > 0
    } catch {
        return false
    }
}

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
    const [adminUser, setAdminUser] = useState<User | null>(null)
    const [isAdmin, setIsAdmin] = useState(false)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let mounted = true

        const initialize = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession()

                if (!mounted) return

                if (session?.user && session.access_token) {
                    const admin = await checkAdminDirect(session.user.id, session.access_token)
                    if (mounted) {
                        if (admin) {
                            setAdminUser(session.user)
                            setIsAdmin(true)
                        }
                    }
                }
            } catch (err) {
                console.warn('AdminAuth: init error', err)
            } finally {
                if (mounted) setLoading(false)
            }
        }

        initialize()

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (_event, session) => {
                if (!mounted) return

                if (session?.user && session.access_token) {
                    const admin = await checkAdminDirect(session.user.id, session.access_token)
                    if (mounted) {
                        setAdminUser(admin ? session.user : null)
                        setIsAdmin(admin)
                        setLoading(false)
                    }
                } else {
                    if (mounted) {
                        setAdminUser(null)
                        setIsAdmin(false)
                        setLoading(false)
                    }
                }
            }
        )

        return () => {
            mounted = false
            subscription.unsubscribe()
        }
    }, [])

    const signOutAdmin = useCallback(async () => {
        await supabase.auth.signOut().catch(() => { })
        setAdminUser(null)
        setIsAdmin(false)
    }, [])

    return (
        <AdminAuthContext.Provider value={{ adminUser, isAdmin, loading, signOutAdmin }}>
            {children}
        </AdminAuthContext.Provider>
    )
}

export function useAdminAuth() {
    const context = useContext(AdminAuthContext)
    if (context === undefined) {
        throw new Error('useAdminAuth must be used within an AdminAuthProvider')
    }
    return context
}
