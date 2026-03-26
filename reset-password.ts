
import { createClient } from "npm:@supabase/supabase-js@2";
import { load } from "https://deno.land/std@0.208.0/dotenv/mod.ts";

const env = await load();
const supabaseUrl = env["VITE_SUPABASE_URL"];
const supabaseServiceKey = env["SUPABASE_SERVICE_ROLE_KEY"];

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing credentials");
    Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});

const userId = "5ecf3f6a-610b-4ae0-a461-ef4d4ad1c7c7";
const newPassword = "password123";

console.log(`Resetting password for user ${userId}...`);

const { data, error } = await supabase.auth.admin.updateUserById(userId, {
    password: newPassword,
});

if (error) {
    console.error("Error updating password:", error);
} else {
    console.log("Password updated successfully!");
    console.log("New credentials:");
    console.log("Email: demo.doctor.2024.v3@test.com");
    console.log(`Password: ${newPassword}`);
}
