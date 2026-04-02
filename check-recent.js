import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkRecent() {
    console.log('Checking recent appointments and clinics...')

    // 1. Check recent hq_appointments
    const { data: apts, error: err1 } = await supabase
        .from('hq_appointments')
        .select('*, clinic_settings(*)')
        .order('created_at', { ascending: false })
        .limit(5)
    
    console.log('Recent Appointments:', JSON.stringify(apts, null, 2))

    // 2. Check recent clinics
    const { data: clinics, error: err2 } = await supabase
        .from('clinic_settings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5)
    
    console.log('Recent Clinics:', JSON.stringify(clinics, null, 2))
}

checkRecent()
