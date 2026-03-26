
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// Manually load .env
try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
        const envFile = fs.readFileSync(envPath, "utf8");
        envFile.split("\n").forEach(line => {
            const [key, ...values] = line.split("=");
            if (key && values.length > 0) {
                process.env[key.trim()] = values.join("=").trim();
            }
        });
    }
} catch (e) {
    console.log("No .env file found or error reading it");
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY from .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log("Checking stats for 'Test Patient Stats'...");

    // Login to get access
    const email = "demo@citenly.com";
    const password = "password123";

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (authError) {
        console.error("Auth Error (Check credentials):", authError.message);
        // Continue anyway, maybe public access works?
    } else {
        console.log("Logged in as:", authData.user.email);
    }

    const { data, error } = await supabase
        .from('patients')
        .select('name, phone_number, total_appointments, last_appointment_at')
        .eq('name', 'Test Patient Stats');

    if (error) {
        console.error("Error fetching stats:", error);
    } else {
        console.log("Patient Stats:", JSON.stringify(data, null, 2));
    }
}

check();
