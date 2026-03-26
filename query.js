import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
    // try to execute sql directly if allowed or use standard rpc
    const { data: users, error: err1 } = await supabase.from('clinic_users').select('*').limit(10)
    const { data: subs, error: err2 } = await supabase.from('subscriptions').select('*').limit(10)

    console.log("users:", JSON.stringify(users, null, 2))
    console.log("subs:", JSON.stringify(subs, null, 2))
}
run()
