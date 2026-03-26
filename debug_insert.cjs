const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

console.log('URL:', process.env.VITE_SUPABASE_URL);
console.log('Key exists:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
    console.log('Attempting insert with +56900000000...');
    const { data, error } = await sb.from("appointments").insert({
        clinic_id: "8c7b8084-259e-4a6c-94cc-1360db45d6dd",
        patient_name: "Colomba Mendez",
        phone_number: "+56900000000",
        service: "Microblading de cejas",
        appointment_date: "2026-03-23T18:00:00-03:00",
        status: "pending",
        duration: 90,
        price: 99000
    }).select().single();

    if (error) {
        console.log("Error Code:", error.code);
        console.log("Error Detail:", error.details || error.message);
        console.log("Error Hint:", error.hint);
    } else {
        console.log("Success! Data ID:", data.id);
    }
}
test();
