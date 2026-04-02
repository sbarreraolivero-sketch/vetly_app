import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkAdmins() {
    console.log('Checking for Platform Admins...')

    // This might fail due to RLS, but we'll see.
    const { data, error } = await supabase
        .from('platform_admins')
        .select('*')
    
    if (error) {
        console.error('Error fetching admins:', error.message)
    } else {
        console.log('Admins found:', data.length)
        console.log('Admins list:', JSON.stringify(data, null, 2))
    }
}

checkAdmins()
