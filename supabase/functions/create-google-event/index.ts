// Create Google Calendar Event Edge Function
// Creates an event using stored tokens, refreshes if expired

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

interface CreateEventRequest {
    title: string;
    description?: string;
    start: string; // ISO string
    end: string; // ISO string
    attendees?: { email: string }[];
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

    // Verify environment variables
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        console.error("Missing Google credentials environment variables");
        return new Response(
            JSON.stringify({ error: "Server misconfiguration (Missing Credentials)" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    try {
        console.log("create-google-event started");
        // Get the authorization header
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            console.error("Missing Authorization header");
            return new Response(
                JSON.stringify({ error: "Missing authorization header" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Read body once
        const body: CreateEventRequest & { user_id?: string } = await req.json();
        let userId = "";

        // CHECK IF SERVICE ROLE (Internal Call)
        if (authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) {
            console.log("Service Role detected.");
            if (body.user_id) {
                userId = body.user_id;
                console.log("Service Role verified. Using provided user_id:", userId);
            } else {
                return new Response(
                    JSON.stringify({ error: "Missing user_id for service role call" }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
        } else {
            // Standard User Call
            const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || "", {
                global: { headers: { Authorization: authHeader } },
            });

            const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
            if (userError || !user) {
                console.error("Supabase auth failed:", userError);
                return new Response(
                    JSON.stringify({ error: "Supabase Auth Failed", details: userError }),
                    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            userId = user.id;
        }

        console.log("User verified:", userId);

        const { title, description, start, end, attendees } = body;

        if (!title || !start || !end) {
            return new Response(
                JSON.stringify({ error: "Missing required fields (title, start, end)" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

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
            .eq("user_id", userId)
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

        let accessToken = tokenData.access_token ? tokenData.access_token.trim() : "";
        const expiresAt = new Date(tokenData.expires_at);

        // Check if token is expired or about to expire (5 min buffer)
        if (expiresAt.getTime() < Date.now() + 5 * 60 * 1000) {
            console.log("Token expired or expiring. Refreshing...");
            if (!tokenData.refresh_token) {
                return new Response(
                    JSON.stringify({
                        error: "Token expired and no refresh token available",
                        code: "TOKEN_EXPIRED"
                    }),
                    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
                    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            accessToken = refreshResult.access_token.trim();
            const newExpiresAt = new Date(Date.now() + refreshResult.expires_in * 1000).toISOString();

            // Update the stored token
            await supabaseAdmin
                .from("google_calendar_tokens")
                .update({
                    access_token: accessToken,
                    expires_at: newExpiresAt,
                    updated_at: new Date().toISOString(),
                })
                .eq("user_id", userId);
        }

        // Create event in Google Calendar API
        const calendarUrl = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

        const eventBody = {
            summary: title,
            description: description,
            start: { dateTime: start },
            end: { dateTime: end },
            attendees: attendees,
        };

        let calendarResponse = await fetch(calendarUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(eventBody),
        });

        // Retry logic for 401 (Invalid Credentials)
        if (calendarResponse.status === 401) {
            console.log("Google API returned 401. Attempting to refresh token...");

            // Re-fetch token data to ensure we have the latest refresh token (avoid race conditions)
            const { data: freshTokenData } = await supabaseAdmin
                .from("google_calendar_tokens")
                .select("refresh_token")
                .eq("user_id", userId)
                .single();

            const refreshTokenToUse = freshTokenData?.refresh_token || tokenData.refresh_token;

            if (!refreshTokenToUse) {
                console.error("No refresh token available to handle 401.");
            } else {
                const refreshResult = await refreshAccessToken(refreshTokenToUse);

                if (refreshResult) {
                    console.log("Token refresh successful. Retrying API request...");
                    accessToken = refreshResult.access_token.trim();
                    const newExpiresAt = new Date(Date.now() + refreshResult.expires_in * 1000).toISOString();

                    // Update stored token
                    await supabaseAdmin
                        .from("google_calendar_tokens")
                        .update({
                            access_token: accessToken,
                            expires_at: newExpiresAt,
                            updated_at: new Date().toISOString(),
                        })
                        .eq("user_id", userId);

                    // Retry request with new token
                    calendarResponse = await fetch(calendarUrl, {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify(eventBody),
                    });
                } else {
                    console.error("Failed to refresh token after 401.");
                }
            }
        }

        console.log("Google Calendar API status:", calendarResponse.status);

        if (!calendarResponse.ok) {
            const errorText = await calendarResponse.text();
            console.error("Google Calendar API error:", errorText);

            if (calendarResponse.status === 401) {
                return new Response(
                    JSON.stringify({
                        error: "Google Calendar API refused token (401)",
                        code: "ACCESS_REVOKED",
                        details: errorText
                    }),
                    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } } // Soft error
                );
            }

            return new Response(
                JSON.stringify({
                    success: false,
                    error: `Google API Error ${calendarResponse.status}`,
                    details: errorText
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } } // Soft error
            );
        }

        const eventData = await calendarResponse.json();

        return new Response(
            JSON.stringify({
                success: true,
                event_id: eventData.id,
                htmlLink: eventData.htmlLink,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error("Create event error:", error);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
