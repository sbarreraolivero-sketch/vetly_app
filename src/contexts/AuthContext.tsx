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
    role: 'owner' | 'admin' | 'staff' | 'super_admin'
    activation_status: 'pending_activation' | 'active' | 'inactive'
    avatar_url?: string
}

export interface Clinic {
    clinic_id: string
    clinic_name: string
    role: 'owner' | 'professional' | 'receptionist'
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
    const [user, setUser] = useState<User | null>(null)
    const [profile, setProfile] = useState<UserProfile | null>(null)
    const [member, setMember] = useState<ClinicMember | null>(null)
    const [subscription, setSubscription] = useState<Subscription | null>(null)
    const [clinics, setClinics] = useState<Clinic[]>([])
    const [session, setSession] = useState<Session | null>(null)
    const [loading, setLoading] = useState(true)

    // Constants
    const PROFILE_STORAGE_KEY = 'Vetly AI_user_profile'
    const SUBSCRIPTION_STORAGE_KEY = 'Vetly AI_user_subscription'
    const CLINICS_STORAGE_KEY = 'Vetly AI_user_clinics'

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
                        setTimeout(() => reject(new Error('Profile fetch timeout')), 5000)
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
                setTimeout(() => reject(new Error('Subscription fetch timeout')), 5000)
            )

            const { data, error } = await Promise.race([fetchPromise, timeoutPromise]) as any

            if (error) {
                // If checking subscription fails, user might not have one yet (new branch?)
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
            return null
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
            // We need to fetch the member details for THIS clinic context
            // Currently teamService.getCurrentMember() uses auth.uid() and current context...
            // BUT RLS depends on current user. 
            // We need to make sure we fetch the member row for THIS clinic.

            // Let's refactor fetching member to be explicit about clinicId if needed, 
            // but usually getCurrentMember queries 'clinic_members' where user_id=me AND clinic_id=profile.clinic_id
            // Since we just updated profile, we need to wait/ensure consistency.

            // Let's manually fetch the specific member row
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
        }, 6000)

        const initializeAuth = async () => {
            try {
                // 1. Try to load from cache
                const cachedProfile = localStorage.getItem(PROFILE_STORAGE_KEY)
                // const cachedSub = localStorage.getItem(SUBSCRIPTION_STORAGE_KEY)
                const cachedClinics = localStorage.getItem(CLINICS_STORAGE_KEY)

                if (cachedProfile && mounted) {
                    try {
                        setProfile(JSON.parse(cachedProfile))
                    } catch (e) { localStorage.removeItem(PROFILE_STORAGE_KEY) }
                }

                // if (cachedSub && mounted) {
                //     try {
                //         setSubscription(JSON.parse(cachedSub))
                //     } catch (e) { localStorage.removeItem(SUBSCRIPTION_STORAGE_KEY) }
                // }

                if (cachedClinics && mounted) {
                    try {
                        setClinics(JSON.parse(cachedClinics))
                    } catch (e) { localStorage.removeItem(CLINICS_STORAGE_KEY) }
                }

                // 2. Check Supabase session
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
                    const { data: profileData, status: profileStatus } = await fetchProfile(session.user.id)
                    if (mounted && profileData) {
                        setProfile(profileData)

                        // Parallel fetch of dependencies
                        // 1. Always fetch clinics
                        const clinicsData = await fetchUserClinics()

                        let subData = null
                        let memberData = null

                        if (profileData.clinic_id) {
                            // 2. Fetch Subscription
                            try {
                                subData = await fetchSubscription(profileData.clinic_id)
                            } catch (e) { console.error('Sub fetch error:', e) }

                            // 3. Fetch Member
                            try {
                                const { data: memberFetchData, error: memberFetchError } = await supabase
                                    .from('clinic_members')
                                    .select('*')
                                    .eq('user_id', session.user.id)
                                    .eq('clinic_id', profileData.clinic_id)
                                    .single()
                                
                                if (memberFetchError) {
                                    console.warn('Member fetch failed, attempting self-repair or fallback...', memberFetchError)
                                    
                                    // Fallback RPC First
                                    const { data: rpcMemberData } = await (supabase as any).rpc('get_myself_clinical_member')
                                    
                                    if (rpcMemberData) {
                                        memberData = rpcMemberData
                                    } else if (profileData.role === 'owner') {
                                        // Self-repair: Create member entry if owner lacks one
                                        console.log('Self-repair: Creating missing owner member entry for:', session.user.email)
                                        const { data: repairData } = await (supabase.from('clinic_members') as any)
                                            .insert({
                                                clinic_id: profileData.clinic_id,
                                                user_id: session.user.id,
                                                email: session.user.email,
                                                role: 'owner',
                                                status: 'active',
                                                first_name: profileData.full_name?.split(' ')[0] || ''
                                            })
                                            .select()
                                            .single()
                                        if (repairData) memberData = repairData
                                    }
                                } else {
                                    memberData = memberFetchData
                                }
                            } catch (e) { console.error('Member fetch exception:', e) }
                        }

                        if (mounted) {
                            if (subData) setSubscription(subData)
                            if (memberData) setMember(memberData as any)

                            // Debug roles match
                            console.log('Role Check:', {
                                profileRole: (profileData as any).role,
                                memberRole: (memberData as any)?.role,
                                userId: session.user.id
                            })

                            console.log('AuthContext initialized with:', {
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
                console.log('🔐 Auth state change:', _event)
                setSession(session)
                setUser(session?.user ?? null)

                if (session?.user) {
                    const { data, status } = await fetchProfile(session.user.id)
                    if (mounted && data) {
                        setProfile(data)
                        fetchUserClinics() // Background refresh
                        if (data.clinic_id) {
                            fetchSubscription(data.clinic_id).then(sub => mounted && setSubscription(sub))
                            supabase.from('clinic_members')
                                .select('*')
                                .eq('user_id', session.user.id)
                                .eq('clinic_id', data.clinic_id)
                                .single()
                                .then(async ({ data: memberData, error: memberError }) => {
                                    if (memberError) {
                                        console.warn('onAuthStateChange member fetch error, trying fallback:', memberError)
                                        const { data: fallbackMember } = await (supabase as any).rpc('get_myself_clinical_member')
                                        if (fallbackMember && mounted) setMember(fallbackMember)
                                    } else if (memberData && mounted) {
                                        setMember(memberData)
                                    }
                                })
                        }
                    } else if (mounted && status === 'not_found' && !window.location.pathname.startsWith('/hq')) {
                        // Prevent Frankenstein session when JWT changes to a non-profile user (like Admin)
                        console.warn('Profile not found from AuthStateChange, clearing session.')
                        setProfile(null)
                        setMember(null)
                        setSubscription(null)
                        setClinics([])
                        localStorage.removeItem(PROFILE_STORAGE_KEY)
                        localStorage.removeItem(SUBSCRIPTION_STORAGE_KEY)
                        localStorage.removeItem(CLINICS_STORAGE_KEY)
                    } else if (mounted && status === 'error') {
                        console.warn('Network error in AuthStateChange, keeping current auth state.')
                    }
                } else {
                    setProfile(null)
                    setMember(null)
                    setSubscription(null)
                    setClinics([])
                    localStorage.clear() // Clear all auth data
                }

                if (mounted) setLoading(false)
            }
        )

        return () => {
            clearTimeout(loadingTimeout)
            mounted = false
            subscription.unsubscribe()
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
