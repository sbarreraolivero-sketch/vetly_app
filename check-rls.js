import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkRLS() {
    console.log('Checking RLS policies for clinic_settings and clinic_members...')

    // We can query pg_policies if we have enough permissions, but usually anon doesn't.
    // Instead, let's try to see if we can at least count the records without filtering.
    
    const { count: countClinics, error: errC } = await supabase
        .from('clinic_settings')
        .select('*', { count: 'exact', head: true })
    
    console.log('Total Clinics count (via anon):', countClinics)
    if (errC) console.error('Error counting clinics:', errC)

    const { count: countMembers, error: errM } = await supabase
        .from('clinic_members')
        .select('*', { count: 'exact', head: true })
    
    console.log('Total Members count (via anon):', countMembers)
    if (errM) console.error('Error counting members:', errM)
}

checkRLS()
