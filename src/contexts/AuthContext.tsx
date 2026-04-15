import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { Database } from '@/types/database'
import { type ClinicMember } from '@/services/teamService'

interface UserProfile {
    id: string
    email: string
    full_name: string
    clinic_id: string
    role: 'owner' | 'admin' | 'staff' | 'super_admin' | 'vet_assistant'
    activation_status: 'pending_activation' | 'active' | 'inactive'
    avatar_url?: string
}

export interface Clinic {
    clinic_id: string
    clinic_name: string
    role: 'owner' | 'professional' | 'receptionist' | 'admin' | 'vet_assistant'
    status: 'active' | 'invited' | 'disabled'
    plan: string
    address?: string
}

type Subscription = Database['public']['Tables']['subscriptions']['Row']

interface AuthContextType {
    user: User | null
    profile: UserProfile | null
    member: ClinicMember | null
    subscription: Subscription | null
    clinics: Clinic[]
    session: Session | null
    loading: boolean
    signIn: (email: string, password: string) => Promise<{ error: Error | null }>
    signUp: (email: string, password: string, fullName: string, clinicName: string, selectedPlan: string, cardToken?: string | null) => Promise<{ error: Error | null }>
    signOut: () => Promise<void>
    connectGoogleCalendar: () => Promise<{ error: Error | null }>
    switchClinic: (clinicId: string) => Promise<void>
    refreshClinics: () => Promise<Clinic[]>
    isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
    // Constants
    const PROFILE_STORAGE_KEY = 'vetly_user_profile'
    const SUBSCRIPTION_STORAGE_KEY = 'vetly_user_subscription'
    const CLINICS_STORAGE_KEY = 'vetly_user_clinics'

    const [user, setUser] = useState<User | null>(null)
    const [profile, setProfile] = useState<UserProfile | null>(() => {
        const cached = localStorage.getItem(PROFILE_STORAGE_KEY)
        try { return cached ? JSON.parse(cached) : null } catch { return null }
    })
    const [member, setMember] = useState<ClinicMember | null>(null)
    const [subscription, setSubscription] = useState<Subscription | null>(null)
    const [clinics, setClinics] = useState<Clinic[]>(() => {
        const cached = localStorage.getItem(CLINICS_STORAGE_KEY)
        try { return cached ? JSON.parse(cached) : [] } catch { return [] }
    })
    const [session, setSession] = useState<Session | null>(null)
    const [loading, setLoading] = useState(true)

    // Fetch user profile from database with retry logic
    const fetchProfile = async (userId: string, retries = 3, delay = 500): Promise<{ data: UserProfile | null, status: 'found' | 'not_found' | 'error' }> => {
        // Bypass profile fetching for HQ routes
        if (window.location.pathname.startsWith('/hq')) {
            console.log('Bypassing profile fetch for HQ route.')
            return { data: null, status: 'not_found' }
        }

        try {
            for (let i = 0; i < retries; i++) {
                try {
                    const fetchPromise = supabase
                        .from('user_profiles')
                        .select('*')
                        .eq('id', userId)
                        .single()

                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Profile fetch timeout')), 15000)
                    )

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const { data, error } = await Promise.race([fetchPromise, timeoutPromise]) as any

                    if (!error && data) {
                        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(data))
                        return { data: data as UserProfile, status: 'found' }
                    }

                    if (error && error.code === 'PGRST116') {
                        console.error('Profile not found for user:', userId)
                        return { data: null, status: 'not_found' }
                    }
                } catch (err) {
                    console.warn(`Attempt ${i + 1} failed to fetch profile. Retrying...`)
                }

                if (i < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay))
                    delay *= 2
                }
            }
            return { data: null, status: 'error' }
        } catch (error) {
            console.error('Fetch profile exception:', error)
            return { data: null, status: 'error' }
        }
    }

    // Fetch user's clinics (for multi-branch)
    const fetchUserClinics = async (): Promise<Clinic[]> => {
        try {
            const { data, error } = await supabase.rpc('get_user_clinics')
            if (error) throw error
            if (data) {
                const clinicsData = data as unknown as Clinic[]
                setClinics(clinicsData)
                localStorage.setItem(CLINICS_STORAGE_KEY, JSON.stringify(clinicsData))
                return clinicsData
            }
        } catch (error) {
            console.error('Error fetching user clinics:', error)
        }
        return []
    }

    // Fetch subscription status
    const fetchSubscription = async (clinicId: string) => {
        try {
            const fetchPromise = supabase
                .from('subscriptions')
                .select('*')
                .eq('clinic_id', clinicId)
                .single()

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Subscription fetch timeout')), 15000)
            )

            const { data, error } = await Promise.race([fetchPromise, timeoutPromise]) as any

            if (error) {
                // PGRST116 is the error for "0 rows found" when using .single()
                if (error.code === 'PGRST116' || error.status === 406) {
                    console.warn('No subscription record found. Using default trial state.')
                    return { status: 'trial', plan: 'trial' } as any
                }
                console.error('Error fetching subscription:', error)
                return null
            }

            if (!error && data) {
                console.log('✅ Fresh Subscription Loaded:', data)
                localStorage.setItem(SUBSCRIPTION_STORAGE_KEY, JSON.stringify(data))
                return data as Subscription
            }
            return null
        } catch (error) {
            console.error('Fetch subscription exception:', error)
            return { status: 'trial', plan: 'trial' } as any
        }
    }

    // Switch active clinic
    const switchClinic = async (clinicId: string) => {
        if (!user || !profile) return

        try {
            // 1. Verify locally if user is member of this clinic
            let targetClinic = clinics.find(c => c.clinic_id === clinicId)

            // If not found locally, try refreshing the list (e.g. just created a branch)
            if (!targetClinic) {
                console.log('Clinic not found locally, refreshing list...')
                const updatedClinics = await fetchUserClinics()
                targetClinic = updatedClinics.find(c => c.clinic_id === clinicId)
            }

            if (!targetClinic) {
                throw new Error('No tienes acceso a esta clínica')
            }

            // 2. Update user_profiles in DB to persist choice
            const { error: updateError } = await (supabase as any)
                .from('user_profiles')
                .update({ clinic_id: clinicId })
                .eq('id', user.id)

            if (updateError) throw updateError

            // 3. Update local state
            const newProfile = { ...profile, clinic_id: clinicId } as UserProfile
            setProfile(newProfile)
            localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(newProfile))

            // 4. Fetch details for new clinic
            const { data: memberData } = await supabase
                .from('clinic_members')
                .select('*')
                .eq('user_id', user.id)
                .eq('clinic_id', clinicId)
                .single()

            if (memberData) setMember(memberData)

            const sub = await fetchSubscription(clinicId)
            setSubscription(sub)

            // Optionally reload page to ensure all components fetch fresh data
            window.location.reload()

        } catch (error) {
            console.error('Error switching clinic:', error)
            alert('Error al cambiar de sucursal. Intenta nuevamente.')
        }
    }

    // Listen for auth changes
    useEffect(() => {
        let mounted = true

        const loadingTimeout = setTimeout(() => {
            console.warn('Auth initialization timeout - forcing loading to false')
            setLoading(false)
        }, 15000)

        const initializeAuth = async () => {
            try {
                // 1. Check Supabase session
                const { data: { session } } = await supabase.auth.getSession()
                if (!mounted) return

                if (session?.user) {
                    setSession(session)
                    setUser(session.user)

                    if (session?.provider_token) {
                        supabase.functions.invoke('store-google-tokens', {
                            body: {
                                access_token: session.provider_token,
                                refresh_token: session.provider_refresh_token || null,
                                expires_in: 3600,
                            },
                        }).catch(err => console.error('Error storing tokens:', err))
                    }

                    // Fetch fresh data
                    const { data: profileData } = await fetchProfile(session.user.id)
                    
                    if (mounted) {
                        // If no profile, we can't do much, but at least we don't loop
                        if (profileData) {
                            setProfile(profileData)
                            
                            // Parallel fetch of dependencies
                            const clinicsData = await fetchUserClinics()
                            
                            let subData = null
                            let memberData = null

                            if (profileData.clinic_id) {
                                // Fetch Subscription with 406 safety
                                subData = await fetchSubscription(profileData.clinic_id)
                                clinicsCount: clinicsData?.length,
                                hasSub: !!subData,
                                hasMember: !!memberData,
                                memberRole: (memberData as any)?.role
                            })
                        }
                    } else if (mounted) {
                        // Profile fetch returned null. We only clear the session if the profile is strictly NOT FOUND.
                        // If it's a network error, we keep the cached profile and let them continue.
                        if (profileStatus === 'not_found' && !window.location.pathname.startsWith('/hq')) {
                            console.warn('Profile not found for this user, clearing Frankenstein session.')
                            setProfile(null)
                            setMember(null)
                            setSubscription(null)
                            setClinics([])
                            localStorage.removeItem(PROFILE_STORAGE_KEY)
                            localStorage.removeItem(SUBSCRIPTION_STORAGE_KEY)
                            localStorage.removeItem(CLINICS_STORAGE_KEY)
                        } else if (profileStatus === 'error') {
                            console.warn('Profile fetch failed due to network error, keeping cached profile if exists.')
                        }
                        setLoading(false)
                    }
                } else {
                    localStorage.removeItem(PROFILE_STORAGE_KEY)
                    localStorage.removeItem(SUBSCRIPTION_STORAGE_KEY)
                    localStorage.removeItem(CLINICS_STORAGE_KEY)
                }
            } catch (error) {
                console.error('Auth initialization exception:', error)
            } finally {
                if (mounted) {
                    setLoading(false)
                    clearTimeout(loadingTimeout)
                }
            }
        }

        initializeAuth()

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (_event, session) => {
                if (!mounted) return
                
                // ONLY set loading to true during the initial setup phase
                if (_event === 'INITIAL_SESSION' && !profile) {
                    setLoading(true)
                }
                
                try {
                    console.log('🔐 Auth state change:', _event, { userId: session?.user?.id })
                    setSession(session)
                    const currentUser = session?.user ?? null
                    setUser(current => (current?.id === currentUser?.id ? current : currentUser))

                    if (currentUser) {
                        const { data, status } = await fetchProfile(currentUser.id)
                        if (mounted && data) {
                            setProfile(prev => {
                                if (prev?.id === data.id && prev?.clinic_id === data.clinic_id) return prev
                                return data
                            })
                            
                            fetchUserClinics() 

                            if (data.clinic_id) {
                                fetchSubscription(data.clinic_id).then(sub => {
                                    if (mounted) {
                                        setSubscription(prev => {
                                            if (JSON.stringify(prev) === JSON.stringify(sub)) return prev
                                            return sub
                                        })
                                    }
                                })

                                supabase.from('clinic_members')
                                    .select('*')
                                    .eq('user_id', currentUser.id)
                                    .eq('clinic_id', data.clinic_id)
                                    .single()
                                    .then(({ data: memberData }) => {
                                        if (memberData && mounted) {
                                            setMember((prev: any) => (prev?.id === (memberData as any).id ? prev : (memberData as any)))
                                        }
                                    })
                            }
                        } else if (mounted && status === 'not_found' && !window.location.pathname.startsWith('/hq')) {
                            setProfile(null)
                            setMember(null)
                            setSubscription(null)
                            setClinics([])
                            localStorage.removeItem(PROFILE_STORAGE_KEY)
                            localStorage.removeItem(SUBSCRIPTION_STORAGE_KEY)
                            localStorage.removeItem(CLINICS_STORAGE_KEY)
                        }
                    } else {
                        setProfile(null)
                        setMember(null)
                        setSubscription(null)
                        setClinics([])
                        localStorage.clear()
                    }
                } catch (err) {
                    console.error('Error in onAuthStateChange:', err)
                } finally {
                    if (mounted) setLoading(false)
                }
            }
        )

        // Auto-refresh when window is focused (e.g. user returns after idle)
        const handleFocus = () => {
            if (session) {
                console.log('Window focused: checking session validity...')
                supabase.auth.getSession().then(({ data: { session: freshSession } }) => {
                    if (freshSession) setSession(freshSession)
                })
            }
        }
        window.addEventListener('focus', handleFocus)

        return () => {
            clearTimeout(loadingTimeout)
            mounted = false
            subscription.unsubscribe()
            window.removeEventListener('focus', handleFocus)
        }
    }, [])

    const signIn = async (email: string, password: string) => {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) return { error: error as Error | null }
        if (data.user) {
            // Let useEffect handle state update or explicitly fetch here for speed
            // For now rely on onAuthStateChange + cached profile fetch above
        }
        return { error: null }
    }

    const signUp = async (email: string, password: string, fullName: string, clinicName: string, selectedPlan: string, cardToken?: string | null) => {
        try {
            const { data, error: functionError } = await supabase.functions.invoke('signup-handler', {
                body: { email, password, full_name: fullName, clinic_name: clinicName, selected_plan: selectedPlan, card_token: cardToken }
            })
            if (functionError) return { error: new Error(functionError.message || 'Error al crear la cuenta') }
            if (data?.error) return { error: new Error(data.error) }

            const { error: signInError } = await authSignIn(email, password)
            if (signInError) return { error: null }
            return { error: null }
        } catch (err) { return { error: err as Error } }
    }

    // Wrap original signIn to avoid recursion in signUp
    const authSignIn = async (email: string, password: string) => {
        return supabase.auth.signInWithPassword({ email, password })
    }

    const signOut = async () => {
        await supabase.auth.signOut()
        setUser(null)
        setProfile(null)
        setSubscription(null)
        setSession(null)
        setClinics([])
        localStorage.clear()
    }

    const connectGoogleCalendar = async () => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                scopes: 'https://www.googleapis.com/auth/calendar',
                queryParams: { access_type: 'offline', prompt: 'consent' },
                redirectTo: `${window.location.origin}/app/appointments?provider_token=true`
            },
        })
        return { error: error as Error | null }
    }

    const value: AuthContextType = {
        user,
        profile,
        member,
        subscription,
        clinics,
        session,
        loading,
        signIn,
        signUp,
        signOut,
        connectGoogleCalendar,
        switchClinic,
        refreshClinics: fetchUserClinics,
        isAuthenticated: !!user && !!profile,
    }

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
    const context = useContext(AuthContext)
    if (context === undefined) throw new Error('useAuth must be used within an AuthProvider')
    return context
}
