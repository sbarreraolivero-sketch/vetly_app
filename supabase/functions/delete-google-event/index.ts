// Delete Google Calendar Event Edge Function
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Refresh the access token using the refresh token
async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
    try {
        const response = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: "refresh_token",
            }),
        });

        if (!response.ok) {
            console.error("Token refresh failed:", await response.text());
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error("Error refreshing token:", error);
        return null;
    }
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(JSON.stringify({ error: "Missing authorization header" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || "", {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
        if (userError || !user) {
            return new Response(JSON.stringify({ error: "Invalid authorization" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const { google_event_id } = await req.json();
        if (!google_event_id) {
            return new Response(JSON.stringify({ error: "Missing google_event_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: tokenData, error: tokenError } = await supabaseAdmin
            .from("google_calendar_tokens")
            .select("*")
            .eq("user_id", user.id)
            .single();

        if (tokenError || !tokenData) {
            return new Response(
                JSON.stringify({
                    error: "No Google Calendar connection found",
                    code: "NOT_CONNECTED"
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        let accessToken = tokenData.access_token;
        const expiresAt = new Date(tokenData.expires_at);

        if (expiresAt.getTime() < Date.now() + 5 * 60 * 1000) {
            if (!tokenData.refresh_token) {
                return new Response(
                    JSON.stringify({
                        error: "Token expired and no refresh token",
                        code: "TOKEN_EXPIRED"
                    }),
                    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            const refreshResult = await refreshAccessToken(tokenData.refresh_token);
            if (!refreshResult) {
                return new Response(
                    JSON.stringify({
                        error: "Failed to refresh token",
                        code: "REFRESH_FAILED"
                    }),
                    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            accessToken = refreshResult.access_token;
            await supabaseAdmin.from("google_calendar_tokens").update({
                access_token: accessToken,
                expires_at: new Date(Date.now() + refreshResult.expires_in * 1000).toISOString(),
                updated_at: new Date().toISOString(),
            }).eq("user_id", user.id);
        }

        let calendarResponse = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${google_event_id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        // Retry logic for 401 (Invalid Credentials)
        if (calendarResponse.status === 401) {
            console.log("Google API returned 401. Attempting to refresh token...");

            if (!tokenData.refresh_token) {
                console.error("No refresh token available to handle 401.");
            } else {
                const refreshResult = await refreshAccessToken(tokenData.refresh_token);

                if (refreshResult) {
                    console.log("Token refresh successful. Retrying API request...");
                    accessToken = refreshResult.access_token;
                    const newExpiresAt = new Date(Date.now() + refreshResult.expires_in * 1000).toISOString();

                    // Update stored token
                    await supabaseAdmin
                        .from("google_calendar_tokens")
                        .update({
                            access_token: accessToken,
                            expires_at: newExpiresAt,
                            updated_at: new Date().toISOString(),
                        })
                        .eq("user_id", user.id);

                    // Retry request with new token
                    calendarResponse = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${google_event_id}`, {
                        method: "DELETE",
                        headers: { Authorization: `Bearer ${accessToken}` },
                    });
                } else {
                    console.error("Failed to refresh token after 401.");
                }
            }
        }

        if (!calendarResponse.ok && calendarResponse.status !== 410) { // 410 means already deleted
            const errorText = await calendarResponse.text();
            console.error("Google Calendar API error:", errorText);

            if (calendarResponse.status === 401) {
                return new Response(
                    JSON.stringify({
                        error: "Google Calendar API refused token (401)",
                        code: "ACCESS_REVOKED",
                        details: errorText
                    }),
                    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Failed to delete event",
                    details: errorText
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const responseBody = calendarResponse.status === 204 ? { success: true } : await calendarResponse.json().catch(() => ({ success: true }));
        return new Response(JSON.stringify(responseBody), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (error) {
        console.error("Delete event error:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
});
