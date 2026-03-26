
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("VITE_SUPABASE_URL") || "";
const supabaseKey = Deno.env.get("VITE_SUPABASE_ANON_KEY") || "";

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
    Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Login to get access (RLS)
const email = "demo@citenly.com";
const password = "password123"; // Assuming demo credentials or similar

const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
});

if (authError) {
    console.error("Auth Error:", authError);
    // Try without auth if RLS allows reading (it should for public?) 
    // Actually, patients table usually RLS protected.
    // Let's assume we need auth.
    Deno.exit(1);
}

console.log("Logged in:", authData.user.email);

const { data, error } = await supabase
    .from('patients')
    .select('name, phone_number, total_appointments, last_appointment_at')
    .eq('name', 'Test Patient Stats');

if (error) {
    console.error("Error fetching stats:", error);
} else {
    console.log("Patient Stats:", data);
}
