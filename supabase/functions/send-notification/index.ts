import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
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
  if (!actor || !["super_admin", "admin", "organizer"].includes(actor.role) || actor.status !== "approved") return Response.json({ error: "staff_required" }, { status: 403, headers: cors });

  const { userIds, kind, message, title = "دوري قاضي عياض", url: targetUrl = "/#home" } = await req.json();
  if (!Array.isArray(userIds) || userIds.length < 1 || userIds.length > 500 || typeof message !== "string" || !message.trim()) return Response.json({ error: "invalid_payload" }, { status: 400, headers: cors });
  const safeTargetUrl = typeof targetUrl === "string" && targetUrl.startsWith("/") && !targetUrl.startsWith("//") ? targetUrl : "/#home";
  const { data: recipients, error: recipientsError } = await admin.from("profiles").select("id").in("id", userIds).eq("status", "approved");
  if (recipientsError) return Response.json({ error: recipientsError.message }, { status: 500, headers: cors });
  const ids = (recipients || []).map((p) => p.id);
  if (!ids.length) return Response.json({ sent: 0, pushSent: 0 }, { headers: cors });
  const { error: noticeError } = await admin.from("notifications").insert(ids.map((user_id) => ({ user_id, kind: kind || "announcement", message: message.trim() })));
  if (noticeError) return Response.json({ error: noticeError.message }, { status: 500, headers: cors });

  let pushSent = 0;
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  const { data: pushSetting } = await admin.from("settings").select("value").eq("key", "push_enabled").maybeSingle();
  if (pushSetting?.value !== false && publicKey && privateKey && subject) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const { data: subs } = await admin.from("push_subscriptions").select("id,user_id,subscription").in("user_id", ids);
    for (const sub of subs || []) {
      try {
        await webpush.sendNotification(sub.subscription, JSON.stringify({ title, body: message.trim(), url: safeTargetUrl }));
        pushSent++;
      } catch (error) {
        const status = statusCodeOf(error);
        if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("id", sub.id);
      }
    }
  }
  await admin.from("audit_log").insert({ actor_id: auth.user.id, action: "send_notification", entity: "notifications", details: { recipient_count: ids.length, push_sent: pushSent } });
  return Response.json({ sent: ids.length, pushSent }, { headers: cors });
});
