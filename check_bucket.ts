
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { config } from 'https://deno.land/x/dotenv/mod.ts'

// Load environment variables
const env = config()
const supabaseUrl = env.VITE_SUPABASE_URL || Deno.env.get('VITE_SUPABASE_URL')
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials')
    Deno.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkStorage() {
    console.log('Checking storage buckets...')
    const { data, error } = await supabase.storage.listBuckets()

    if (error) {
        console.error('Error listing buckets:', error)
        return
    }

    const bucket = data.find(b => b.name === 'clinical-photos')
    if (bucket) {
        console.log('✅ Bucket "clinical-photos" exists.')
        console.log('Is Public:', bucket.public)
    } else {
        console.error('❌ Bucket "clinical-photos" DOES NOT exist.')
    }
}

checkStorage()
