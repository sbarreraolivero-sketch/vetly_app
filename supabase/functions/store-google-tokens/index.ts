// Store Google Calendar OAuth Tokens Edge Function
// Stores access_token and refresh_token securely in the database

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TokenRequest {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
}

Deno.serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    try {
        // Get the authorization header to identify the user
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: "Missing authorization header" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Create client with user's token to get their identity
        const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || "", {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: "Invalid authorization" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const body: TokenRequest = await req.json();
        const { access_token, refresh_token, expires_in, scope } = body;

        if (!access_token) {
            return new Response(
                JSON.stringify({ error: "Missing access_token" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Calculate expiration time
        const expires_at = expires_in
            ? new Date(Date.now() + expires_in * 1000).toISOString()
            : new Date(Date.now() + 3600 * 1000).toISOString(); // Default 1 hour

        // Create admin client to upsert tokens
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });

        // Prepare token data, only including refresh_token if provided
        const tokenData: any = {
            user_id: user.id,
            access_token,
            expires_at,
            scope,
            updated_at: new Date().toISOString(),
        };

        if (refresh_token) {
            tokenData.refresh_token = refresh_token;
        } else {
            console.log("No refresh_token in request. Preserving existing refresh_token if any.");
        }

        console.log("Attempting to upsert tokens for user:", user.id);
        console.log("Token data keys:", Object.keys(tokenData));

        console.log("Service Role Key length:", SUPABASE_SERVICE_ROLE_KEY.length);

        const { data, error } = await supabaseAdmin
            .from("google_calendar_tokens")
            .upsert(tokenData, {
                onConflict: "user_id",
            })
            .select()
            .single();

        if (error) {
            console.error("Error storing tokens in DB:", error);
            console.error("Token Data Payload:", JSON.stringify(tokenData));
            return new Response(
                JSON.stringify({ error: "Failed to store tokens", details: error }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        console.log("Tokens stored successfully. Row ID:", data.id, "Has refresh_token:", !!data.refresh_token);

        return new Response(
            JSON.stringify({
                success: true,
                message: "Tokens stored successfully",
                expires_at,
                has_refresh_token: !!data.refresh_token
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error("Store tokens error:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
