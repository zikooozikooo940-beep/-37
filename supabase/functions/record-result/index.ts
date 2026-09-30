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
  const url=Deno.env.get("SUPABASE_URL")!, anon=Deno.env.get("SUPABASE_ANON_KEY")!, service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authorization=req.headers.get("Authorization");
  if(!authorization)return Response.json({error:"unauthorized"},{status:401,headers:cors});
  const caller=createClient(url,anon,{global:{headers:{Authorization:authorization}}}), admin=createClient(url,service);
  const {data:auth,error:authError}=await caller.auth.getUser();
  if(authError||!auth.user)return Response.json({error:"unauthorized"},{status:401,headers:cors});
  const {matchId,score1,score2}=await req.json();
  if(!matchId||!Number.isInteger(score1)||!Number.isInteger(score2)||score1<0||score2<0||score1===score2)return Response.json({error:"invalid_score"},{status:400,headers:cors});
  const {data:actor}=await admin.from("profiles").select("role,status").eq("id",auth.user.id).single();
  const {data:match,error:matchError}=await admin.from("matches").select("id,team1,team2,referee_id,tournament_id").eq("id",matchId).single();
  if(matchError||!match)return Response.json({error:"match_not_found"},{status:404,headers:cors});
  const manager=actor?.status==="approved"&&["super_admin","admin","organizer"].includes(actor.role);
  const assignedReferee=actor?.status==="approved"&&actor.role==="referee"&&match.referee_id===auth.user.id;
  if(!manager&&!assignedReferee)return Response.json({error:"not_authorized_for_match"},{status:403,headers:cors});
  const winner=score1>score2?match.team1:match.team2;
  const {data:nextMatch,error}=await caller.rpc("record_match_result",{p_match_id:matchId,p_score1:score1,p_score2:score2});
  if(error)return Response.json({error:error.message},{status:400,headers:cors});
  const {data:registrations}=await admin.from("registrations").select("user_id").eq("tournament_id",match.tournament_id).eq("team_name",winner).eq("registration_status","approved");
  const ids=[...new Set((registrations||[]).map((r)=>r.user_id))];
  let pushSent=0;
  const publicKey=Deno.env.get("VAPID_PUBLIC_KEY"),privateKey=Deno.env.get("VAPID_PRIVATE_KEY"),subject=Deno.env.get("VAPID_SUBJECT");
  const {data:pushSetting}=await admin.from("settings").select("value").eq("key","push_enabled").maybeSingle();
  if(ids.length&&pushSetting?.value!==false&&publicKey&&privateKey&&subject){
    webpush.setVapidDetails(subject,publicKey,privateKey);
    const {data:subscriptions}=await admin.from("push_subscriptions").select("id,subscription").in("user_id",ids);
    const message=`${winner} فاز في المباراة بنتيجة ${score1} – ${score2}.`;
    for(const sub of subscriptions||[]){try{await webpush.sendNotification(sub.subscription,JSON.stringify({title:"نتيجة المباراة",body:message,url:"/#matches"}));pushSent++;}catch(error){const status=statusCodeOf(error);if(status===404||status===410)await admin.from("push_subscriptions").delete().eq("id",sub.id);}}
  }
  await admin.from("audit_log").insert({actor_id:auth.user.id,action:"record_result_and_notify",entity:"matches",entity_id:matchId,details:{winner,push_sent:pushSent}});
  return Response.json({ok:true,winner,nextMatch,pushSent},{headers:cors});
});
