import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await request.json();
    const appwriteJwt = typeof body.appwriteJwt === "string" ? body.appwriteJwt : "";
    if (!appwriteJwt || appwriteJwt.length > 10000) return json({ error: "Missing Appwrite session" }, 401);

    const appwriteEndpoint = Deno.env.get("APPWRITE_ENDPOINT") || "https://fra.cloud.appwrite.io/v1";
    const appwriteProjectId = Deno.env.get("APPWRITE_PROJECT_ID") || "6ab6b317000768639ecc";
    const appwriteResponse = await fetch(appwriteEndpoint.replace(/\/+$/, "") + "/account", {
      headers: {
        "X-Appwrite-Project": appwriteProjectId,
        "X-Appwrite-JWT": appwriteJwt,
      },
    });
    if (!appwriteResponse.ok) return json({ error: "Appwrite session is invalid or expired" }, 401);
    const appwriteUser = await appwriteResponse.json();
    // A valid Appwrite session already proves authentication. Email OTP is a separate
    // login flow and does not set the optional emailVerification profile flag.
    const email = String(appwriteUser.email || "").trim().toLowerCase();
    if (!email) return json({ error: "Authenticated email is required" }, 403);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Supabase function secrets are not configured" }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    let authUser = null;
    for (let page = 1; page <= 100; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      const users = data.users || [];
      authUser = users.find((user) => (user.email || "").toLowerCase() === email) || null;
      if (authUser || users.length < 1000) break;
    }

    const requestedRole = body.requestedRole === "player" ? "player" : "follower";
    const requestedTeam = typeof body.requestedTeam === "string" ? body.requestedTeam.trim().slice(0, 80) : "";
    const suppliedName = String(body.displayName || appwriteUser.name || "").trim().slice(0, 120);
    const usableName = suppliedName && suppliedName !== "عضو جديد" ? suppliedName : "";
    if (!authUser) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          display_name: usableName || "عضو جديد",
          requested_role: requestedRole,
          player_data: requestedRole === "player" && requestedTeam ? { requested_team: requestedTeam } : {},
        },
      });
      if (error) throw error;
      authUser = data.user;
    } else if (!authUser.email_confirmed_at) {
      const { data, error } = await admin.auth.admin.updateUserById(authUser.id, { email_confirm: true });
      if (error) throw error;
      authUser = data.user;
    }

    // Repair profiles created by an earlier bridge run that left the placeholder name.
    if (usableName) {
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("display_name,player_data,status")
        .eq("id", authUser.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (profile && (!profile.display_name || profile.display_name === "عضو جديد")) {
        const { error } = await admin.from("profiles")
          .update({ display_name: usableName })
          .eq("id", authUser.id);
        if (error) throw error;
      }
      if (profile?.status === "pending" && requestedRole === "player" && requestedTeam) {
        const { error } = await admin.from("profiles")
          .update({ player_data: { ...(profile.player_data || {}), requested_team: requestedTeam } })
          .eq("id", authUser.id);
        if (error) throw error;
      }
    }

    // Keep the existing profiles.role/status untouched: an already-approved super_admin stays admin.
    const { data: generated, error: generateError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (generateError) throw generateError;
    const tokenHash = generated.properties?.hashed_token;
    if (!tokenHash) throw new Error("No Supabase token hash was returned");

    const verifyResponse = await fetch(supabaseUrl.replace(/\/+$/, "") + "/auth/v1/verify", {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
    });
    const session = await verifyResponse.json().catch(() => ({}));
    if (!verifyResponse.ok || !session.access_token || !session.refresh_token) {
      throw new Error("Could not exchange the verified identity for a league session");
    }
    return json({ session });
  } catch (_error) {
    return json({ error: "تعذر ربط حساب Appwrite بقاعدة الدوري. تحقق من إعدادات الدالة." }, 500);
  }
});

