
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
        const value = match[2].trim().replace(/^['"]|['"]$/g, "");
        env[key] = value;
    }
});

const supabaseUrl = env["VITE_SUPABASE_URL"];
const supabaseServiceKey = env["SUPABASE_SERVICE_ROLE_KEY"];

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing credentials in .env");
    process.exit(1);
}

// Helper fetch function
async function supabaseFetch(endpoint, method = "GET", body = null) {
    const options = {
        method,
        headers: {
            "Content-Type": "application/json",
            "apikey": supabaseServiceKey,
            "Authorization": `Bearer ${supabaseServiceKey}`,
        },
    };
    if (body) options.body = JSON.stringify(body);

    return fetch(`${supabaseUrl}/auth/v1/admin/${endpoint}`, options);
}

console.log("Listing users...");
const listRes = await supabaseFetch("users");
const data = await listRes.json();
console.log("Full response:", JSON.stringify(data, null, 2));
const users = data.users || [];

const demoEmails = [
    "demo.doctor.2024.v3@test.com",
    "doctor.demo@elistic.ia",
    "demo.doctor@elistic.ia",
    "doctor.demo.final@elistic.ia",
    "demo.doctor.v4@elistic.ia"
];

const usersToDelete = users.filter(u => demoEmails.includes(u.email));

console.log(`Found ${usersToDelete.length} demo users to delete.`);

for (const user of usersToDelete) {
    console.log(`Deleting user: ${user.email} (${user.id})`);
    const delRes = await supabaseFetch(`users/${user.id}`, "DELETE");
    if (delRes.ok) {
        console.log("Deleted successfully.");
    } else {
        console.error("Failed to delete:", await delRes.text());
    }
}
