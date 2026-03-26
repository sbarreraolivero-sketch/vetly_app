import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function test() {
    // 1. Sign in as the user
    const { data: { session }, error: loginError } = await supabase.auth.signInWithPassword({
        email: 'contacto@vetly.pro',
        password: 'password123' // I don't have the password, so I can't sign in this way.
    })
    
    // Alternative: Use service role to check what the query returns without RLS, then simulate RLS?
    // No, I can't simulate RLS easily without signing in.
    
    // Let's just query with service role to see if the rows exist and appear correct.
}
