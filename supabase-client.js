/* عميل صغير لـ Supabase Auth + PostgREST. لا يحتوي أي مفتاح سري. */
(() => {
  const CONFIG_KEY = 'qadiyadh-supabase-config';
  const SESSION_KEY = 'qadiyadh-auth-session';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null'); } catch { return null; } })();
  const siteConfig = window.LEAGUE_SUPABASE || {};
  const config = { url: siteConfig.url || saved?.url || '', anonKey: siteConfig.anonKey || saved?.anonKey || '', vapidPublicKey: siteConfig.vapidPublicKey || saved?.vapidPublicKey || '' };
  let session = (() => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } })();
  const normalize = v => String(v || '').replace(/\/+$/, '');
  const configured = () => /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(normalize(config.url)) && typeof config.anonKey === 'string' && config.anonKey.length > 20;
  const storeSession = v => { session = v; if (v) sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)); else sessionStorage.removeItem(SESSION_KEY); };
  async function request(path, { method='GET', body, token, query, headers={} }={}) {
    if (!configured()) throw new Error('أدخل رابط مشروع Supabase والمفتاح العام أولًا.');
    if (!token && session?.refresh_token) await validSession();
    const url = new URL(`${normalize(config.url)}/${path.replace(/^\//,'')}`);
    if (query) Object.entries(query).forEach(([k,v])=>url.searchParams.set(k,v));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      const bearerCandidate = token || session?.access_token || (config.anonKey.startsWith('eyJ') ? config.anonKey : '');
      const bearer = bearerCandidate.startsWith('sb_publishable_') ? '' : bearerCandidate;
      response = await fetch(url, { method, headers: { apikey: config.anonKey, ...(bearer ? {Authorization:`Bearer ${bearer}`} : {}), 'Content-Type':'application/json', ...headers }, body: body===undefined?undefined:JSON.stringify(body), signal:controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('استغرق الاتصال أكثر من ١٥ ثانية. تحقق من الإنترنت وحاول مرة أخرى.');
      if (err instanceof TypeError) throw new Error('تعذر الوصول إلى Supabase. تحقق من رابط المشروع والإنترنت وإعدادات الاتصال.');
      throw err;
    } finally { clearTimeout(timeout); }
    const text = await response.text(); let data; try { data=text?JSON.parse(text):null; } catch { data=text; }
    if (!response.ok) { const err = new Error(data?.msg || data?.message || data?.error_description || `تعذر الاتصال بخدمة الدوري (${response.status})`); err.status=response.status; throw err; }
    return data;
  }
  async function refresh() {
    if (!session?.refresh_token) return null;
    const data=await request('auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token},token:config.anonKey});
    storeSession(data); return data;
  }
  async function validSession() {
    if (!session?.access_token) return null;
    if (session.expires_at && session.expires_at < Math.floor(Date.now()/1000)+30) { try { await refresh(); } catch { storeSession(null); return null; } }
    return session;
  }
  const auth = {
    get configured(){return configured();}, get config(){return {url:normalize(config.url),anonKey:config.anonKey,vapidPublicKey:config.vapidPublicKey};},
    get session(){return session;},
    async signIn(email,password){const v=await request('auth/v1/token?grant_type=password',{method:'POST',body:{email,password},token:config.anonKey});storeSession(v);return v;},
    async signUp({email,password,name,role}){const v=await request('auth/v1/signup',{method:'POST',body:{email,password,data:{display_name:name,requested_role:role}},token:config.anonKey});if(v?.access_token)storeSession(v);return v;},
    async signOut(){try{if(session?.access_token)await request('auth/v1/logout',{method:'POST'});}finally{storeSession(null);}},
    async profile(){const s=await validSession();if(!s?.user?.id)return null;const rows=await request('rest/v1/profiles',{query:{select:'id,display_name,role,status,avatar_url,joined_at',id:`eq.${s.user.id}`,limit:'1'}});return rows?.[0]||null;},
    async saveConfig(url,anonKey,vapidPublicKey){const clean=normalize(url);if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(clean))throw new Error('رابط Supabase غير صحيح.');if(!anonKey||anonKey.length<20)throw new Error('المفتاح العام غير مكتمل.');localStorage.setItem(CONFIG_KEY,JSON.stringify({url:clean,anonKey,vapidPublicKey:vapidPublicKey||''}));},
    async table(name,{select='*',filters={},order,limit=100}={}){const q={select,limit:String(limit)};Object.assign(q,filters);if(order)q.order=order;return request(`rest/v1/${name}`,{query:q});},
    async insert(name,rows,returning='representation'){return request(`rest/v1/${name}`,{method:'POST',body:rows,headers:{Prefer:`return=${returning}`}});},
    async upsert(name,rows,onConflict,returning='minimal'){return request(`rest/v1/${name}`,{method:'POST',query:{on_conflict:onConflict},body:rows,headers:{Prefer:`resolution=merge-duplicates,return=${returning}`}});},
    async update(name,filters,patch){return request(`rest/v1/${name}`,{method:'PATCH',query:filters,body:patch,headers:{Prefer:'return=representation'}});},
    async uploadObject(bucket,path,blob,contentType='application/octet-stream'){
      const s=await validSession();if(!s?.access_token)throw new Error('انتهت جلسة الدخول. سجّل الدخول مجددًا.');
      const objectPath=path.split('/').map(encodeURIComponent).join('/');
      const response=await fetch(`${normalize(config.url)}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`,{method:'POST',headers:{apikey:config.anonKey,Authorization:`Bearer ${s.access_token}`,'Content-Type':contentType,'x-upsert':'true'},body:blob});
      if(!response.ok){let detail='';try{const data=await response.json();detail=data.message||data.error||''}catch{}throw new Error(detail||`تعذر رفع الصورة (${response.status})`)}return response.json();
    },
    async signedObjectUrls(bucket,paths,expiresIn=3600){
      if(!paths.length)return{};const rows=await request(`storage/v1/object/sign/${encodeURIComponent(bucket)}`,{method:'POST',body:{expiresIn,paths}});
      return Object.fromEntries((rows||[]).map(row=>[row.path,`${normalize(config.url)}/storage/v1${row.signedURL}`]));
    },
    async rpc(name,args={}){return request(`rest/v1/rpc/${name}`,{method:'POST',body:args});},
    async invoke(name,body){return request(`functions/v1/${name}`,{method:'POST',body});},
    async getMyNotifications(){const s=await validSession();if(!s?.user?.id)return[];return this.table('notifications',{select:'id,kind,message,read_at,created_at',filters:{user_id:`eq.${s.user.id}`,order:'created_at.desc'},limit:20});},
  };
  window.LeagueDB=auth;
})();
