
import fs from "fs";
import path from "path";

// Leer variables de .env manualmente
const envPath = path.resolve(process.cwd(), ".env");
const envContent = fs.readFileSync(envPath, "utf-8");
const env = {};

envContent.split("\n").forEach((line) => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^['"]|['"]$/g, ""); // Remover comillas
        env[key] = value;
    }
});

const supabaseUrl = env["VITE_SUPABASE_URL"];
const supabaseServiceKey = env["SUPABASE_SERVICE_ROLE_KEY"];

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing credentials in .env");
    process.exit(1);
}

const userId = "5ecf3f6a-610b-4ae0-a461-ef4d4ad1c7c7";
const newPassword = "Password123!";

console.log(`Resetting password using FETCH for user ${userId}...`);
console.log(`URL: ${supabaseUrl}`);

const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: {
        "Content-Type": "application/json",
        "apikey": supabaseServiceKey,
        "Authorization": `Bearer ${supabaseServiceKey}`,
    },
    body: JSON.stringify({
        password: newPassword,
    }),
});

if (!response.ok) {
    const errorText = await response.text();
    console.error(`Error ${response.status}:`, errorText);
} else {
    const data = await response.json();
    console.log("Password updated successfully via FETCH!");
    console.log("Email: demo.doctor.2024.v3@test.com");
    console.log(`Password: ${newPassword}`);
}
