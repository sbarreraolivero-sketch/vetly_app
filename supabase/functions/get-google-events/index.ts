// Get Google Calendar Events Edge Function
// Retrieves events using stored tokens, refreshes if expired

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GoogleEvent {
    id: string;
    summary: string;
    description?: string;
    start: { dateTime?: string; date?: string };
    end: { dateTime?: string; date?: string };
    htmlLink?: string;
}

interface GoogleEventsResponse {
    items: GoogleEvent[];
    nextPageToken?: string;
}

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
    console.log("🚀 get-google-events v2.1 (Soft Error Fix) invoked");
    console.log("Request Method:", req.method);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    if (req.method !== "GET") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    try {
        // Get the authorization header
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: "Missing authorization header" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Verify the user
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

        // Get query parameters
        const url = new URL(req.url);
        const timeMin = url.searchParams.get("timeMin") || new Date().toISOString();
        const timeMax = url.searchParams.get("timeMax") || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        // Get stored tokens using service role
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });

        const { data: tokenData, error: tokenError } = await supabaseAdmin
            .from("google_calendar_tokens")
            .select("*")
            .eq("user_id", user.id)
            .single();

        if (tokenError || !tokenData) {
            return new Response(
                JSON.stringify({
                    error: "No Google Calendar connection found",
                    code: "NOT_CONNECTED",
                    success: false
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        let accessToken = tokenData.access_token;
        const expiresAt = new Date(tokenData.expires_at);

        // Check if token is expired or about to expire (5 min buffer)
        if (expiresAt.getTime() < Date.now() + 5 * 60 * 1000) {
            if (!tokenData.refresh_token) {
                return new Response(
                    JSON.stringify({
                        error: "Token expired and no refresh token available",
                        code: "TOKEN_EXPIRED"
                    }),
                    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            // Refresh the token
            const refreshResult = await refreshAccessToken(tokenData.refresh_token);
            if (!refreshResult) {
                return new Response(
                    JSON.stringify({
                        error: "Failed to refresh token",
                        code: "REFRESH_FAILED"
                    }),
                    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            accessToken = refreshResult.access_token;
            const newExpiresAt = new Date(Date.now() + refreshResult.expires_in * 1000).toISOString();

            // Update the stored token
            await supabaseAdmin
                .from("google_calendar_tokens")
                .update({
                    access_token: accessToken,
                    expires_at: newExpiresAt,
                    updated_at: new Date().toISOString(),
                })
                .eq("user_id", user.id);
        }

        // Fetch events from Google Calendar API
        const calendarUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
        calendarUrl.searchParams.set("timeMin", timeMin);
        calendarUrl.searchParams.set("timeMax", timeMax);
        calendarUrl.searchParams.set("singleEvents", "true");
        calendarUrl.searchParams.set("orderBy", "startTime");
        calendarUrl.searchParams.set("maxResults", "100");

        const calendarResponse = await fetch(calendarUrl.toString(), {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        if (!calendarResponse.ok) {
            const errorText = await calendarResponse.text();
            console.error("Google Calendar API error:", errorText);

            if (calendarResponse.status === 401) {
                // Token was revoked or invalid
                return new Response(
                    JSON.stringify({
                        error: "Google Calendar access revoked",
                        code: "ACCESS_REVOKED",
                        success: false
                    }),
                    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            return new Response(
                JSON.stringify({ error: "Failed to fetch calendar events" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const eventsData: GoogleEventsResponse = await calendarResponse.json();

        // Transform events into a simpler format
        const events = (eventsData.items || []).map((event: GoogleEvent) => ({
            id: event.id,
            title: event.summary || "(Sin título)",
            description: event.description,
            start: event.start.dateTime || event.start.date,
            end: event.end.dateTime || event.end.date,
            isAllDay: !event.start.dateTime,
            htmlLink: event.htmlLink,
            source: "google",
        }));

        return new Response(
            JSON.stringify({
                success: true,
                events,
                count: events.length,
                version: "2.1"
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error("Get events error:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
