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
  const rejectionReason = typeof reason === "string" ? reason.trim() : "";
  if (!requestId || !["approved", "rejected"].includes(decision) || (decision === "rejected" && (rejectionReason.length < 3 || rejectionReason.length > 500))) return Response.json({ error: "invalid_request" }, { status: 400, headers: cors });
  const { data: reviewed, error: reviewError } = await admin.rpc("review_join_request", {
    p_request_id: requestId,
    p_decision: decision,
    p_reason: rejectionReason,
    p_actor_id: auth.user.id,
  });
  if (reviewError || !reviewed?.[0]) {
    const message = reviewError?.message || "request_not_pending";
    const status = message.includes("request_not_pending") ? 409 : message.includes("super_admin_required") ? 403 : 500;
    return Response.json({ error: message }, { status, headers: cors });
  }
  const roleRequest = reviewed[0];
  const message = decision === "approved" ? "تمت الموافقة على طلبك. مرحبًا بك في دوري قاضي عياض." : `لم تتم الموافقة على طلب الانضمام. السبب: ${rejectionReason}`;
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
