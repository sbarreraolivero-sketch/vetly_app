import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function check() {
    const email = 'claubarreraolivero@gmail.com'
    console.log(`Checking for email: ${email}`)

    // 1. Check clinic_members
    const { data: members, error: err1 } = await supabase
        .from('clinic_members')
        .select('*, clinic_settings(*)')
        .eq('email', email)
    
    console.log('Members:', JSON.stringify(members, null, 2))
    if (err1) console.error('Error fetching members:', err1)

    // 2. Check hq_appointments
    if (members && members.length > 0) {
        const clinicId = members[0].clinic_id
        const { data: apts, error: err2 } = await supabase
            .from('hq_appointments')
            .select('*')
            .eq('clinic_id', clinicId)
        
        console.log('Appointments for clinic:', JSON.stringify(apts, null, 2))
        if (err2) console.error('Error fetching appointments:', err2)
    } else {
        // Maybe the email is different or missing in clinic_members but exists in user_profiles?
        const { data: profiles, error: err3 } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('email', email)
        
        console.log('Profiles:', JSON.stringify(profiles, null, 2))
        if (err3) console.error('Error fetching profiles:', err3)
    }
}

check()
