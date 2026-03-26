const { createClient } = require('@supabase/supabase-js');

const url = "https://hubjqllcmbzoojyidgcu.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1YmpxbGxjbWJ6b29qeWlkZ2N1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDE0OTc3MCwiZXhwIjoyMDg1NzI1NzcwfQ.lnOepDZP06NwIvROxdHZG6sLST4vJs51QIDCQs7cF6o";
const sb = createClient(url, key);

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
        console.log("Error Message:", error.message);
        console.log("Error Detail:", error.details);
        console.log("Error Hint:", error.hint);
    } else {
        console.log("Success! Data ID:", data.id);
    }
}
test();
