
const supabaseUrl = "https://hubjqllcmbzoojyidgcu.supabase.co";
const supabaseServiceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1YmpxbGxjbWJ6b29qeWlkZ2N1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDE0OTc3MCwiZXhwIjoyMDg1NzI1NzcwfQ.lnOepDZP06NwIvROxdHZG6sLST4vJs51QIDCQs7cF6o";

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
