import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const SB_URL = "https://hubjqllcmbzoojyidgcu.supabase.co"
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sb = createClient(SB_URL, SB_KEY);
async function run() {
    const { data, error } = await sb.from("debug_logs").select("*").order("created_at", { ascending: false }).limit(10);
    if (error) {
        console.error(error);
        return;
    }
    console.log(JSON.stringify(data, null, 2));
}
run();
