import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const statusCodeOf = (error: unknown): number | undefined =>
  typeof error === "object" && error !== null && "statusCode" in error
    ? (error as { statusCode?: number }).statusCode
    : undefined;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authorization = req.headers.get("Authorization");
  if (!authorization) return Response.json({ error: "unauthorized" }, { status: 401, headers: cors });
  const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(url, service);
  const { data: auth, error: authError } = await caller.auth.getUser();
  if (authError || !auth.user) return Response.json({ error: "unauthorized" }, { status: 401, headers: cors });
  const { data: actor } = await admin.from("profiles").select("role,status").eq("id", auth.user.id).single();
  if (!actor || actor.role !== "super_admin" || actor.status !== "approved") return Response.json({ error: "super_admin_required" }, { status: 403, headers: cors });
  const { requestId, decision, reason = "" } = await req.json();
  const reviewMessage = typeof reason === "string" ? reason.trim() : "";
  if (!requestId || !["approved", "rejected"].includes(decision) || reviewMessage.length > 500 || (decision === "rejected" && reviewMessage.length < 3)) return Response.json({ error: "invalid_request" }, { status: 400, headers: cors });
  const { data: reviewed, error: reviewError } = await admin.rpc("review_join_request", {
    p_request_id: requestId,
    p_decision: decision,
    p_reason: reviewMessage,
    p_actor_id: auth.user.id,
  });
  if (reviewError || !reviewed?.[0]) {
    const message = reviewError?.message || "request_not_pending";
    const status = message.includes("request_not_pending") ? 409 : message.includes("super_admin_required") ? 403 : 500;
    return Response.json({ error: message }, { status, headers: cors });
  }
  const roleRequest = reviewed[0];
  if (decision === "approved" && roleRequest.requested_role === "player") {
    const { data: applicant, error: applicantError } = await admin
      .from("profiles")
      .select("player_data")
      .eq("id", roleRequest.user_id)
      .maybeSingle();
    if (applicantError) return Response.json({ error: "could_not_load_player_team_request" }, { status: 500, headers: cors });
    const requestedTeam = String(applicant?.player_data?.requested_team || "").trim();
    if (requestedTeam) {
      const { data: seasons, error: seasonsError } = await admin
        .from("tournaments")
        .select("id")
        .in("status", ["registration", "scheduled", "active"])
        .order("created_at", { ascending: false })
        .limit(1);
      if (seasonsError) return Response.json({ error: "could_not_load_current_league" }, { status: 500, headers: cors });
      const tournamentId = seasons?.[0]?.id;
      if (tournamentId) {
        const { data: fixtures, error: fixturesError } = await admin
          .from("matches")
          .select("team1,team2")
          .eq("tournament_id", tournamentId)
          .eq("round_number", 1);
        if (fixturesError) return Response.json({ error: "could_not_load_participating_teams" }, { status: 500, headers: cors });
        const officialTeams = new Set((fixtures || []).flatMap((match) => [match.team1, match.team2].filter(Boolean)));
        if (officialTeams.has(requestedTeam)) {
          const playerData = applicant.player_data || {};
          const { error: teamError } = await admin.from("profiles")
            .update({ player_data: { ...playerData, team: requestedTeam, requested_team: null } })
            .eq("id", roleRequest.user_id);
          if (teamError) return Response.json({ error: "could_not_assign_requested_team" }, { status: 500, headers: cors });
        }
      }
    }
  }
  const message = decision === "approved"
    ? "تمت الموافقة على طلبك. مرحبًا بك في دوري قاضي عياض." + (reviewMessage ? `\n\nرسالة الإدارة: ${reviewMessage}` : "")
    : `لم تتم الموافقة على طلب الانضمام. السبب: ${reviewMessage}`;
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  const { data: pushSetting } = await admin.from("settings").select("value").eq("key", "push_enabled").maybeSingle();
  if (pushSetting?.value !== false && vapidPublic && vapidPrivate && vapidSubject) {
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const { data: subscriptions } = await admin.from("push_subscriptions").select("id,subscription").eq("user_id", roleRequest.user_id);
    for (const sub of subscriptions || []) {
      try { await webpush.sendNotification(sub.subscription, JSON.stringify({ title: "دوري قاضي عياض", body: message, url: "/#home" })); }
      catch (error) { const status = statusCodeOf(error); if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("id", sub.id); }
    }
  }
  return Response.json({ ok: true, userId: roleRequest.user_id, role: roleRequest.requested_role, decision }, { headers: cors });
});
