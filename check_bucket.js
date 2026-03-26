
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

// Load environment variables manually
const envPath = path.resolve(process.cwd(), '.env')
let supabaseUrl = process.env.VITE_SUPABASE_URL
let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8')
    envConfig.split('\n').forEach(line => {
        const [key, value] = line.split('=')
        if (key && value) {
            if (key.trim() === 'VITE_SUPABASE_URL') supabaseUrl = value.trim()
            if (key.trim() === 'SUPABASE_SERVICE_ROLE_KEY') supabaseKey = value.trim()
            if (key.trim() === 'VITE_SUPABASE_ANON_KEY' && !supabaseKey) supabaseKey = value.trim()
        }
    })
}

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
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
