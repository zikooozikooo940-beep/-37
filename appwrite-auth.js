/* Appwrite is the login provider. Verified identities are bridged server-side to Supabase RLS. */
(() => {
  const appConfig = window.LEAGUE_APPWRITE || {};
  const sbConfig = window.LEAGUE_SUPABASE || {};
  const sdk = window.Appwrite;
  const configured = !!(sdk && appConfig.endpoint && appConfig.projectId && sbConfig.url && sbConfig.anonKey);
  let account = null;

  if (configured) {
    const client = new sdk.Client().setEndpoint(appConfig.endpoint).setProject(appConfig.projectId);
    account = new sdk.Account(client);
  }

  function requireReady() {
    if (!configured) throw new Error('إعداد Appwrite أو اتصال Supabase غير مكتمل.');
  }

  function cleanCallbackUrl() {
    history.replaceState(null, '', location.pathname + location.hash);
  }

  function callbackUrl(flow) {
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set('flow', flow);
    return url.toString();
  }

  async function bridgeVerifiedUser(user, requestedRole) {
    const token = await account.createJWT();
    const headers = { apikey: sbConfig.anonKey, 'Content-Type': 'application/json' };
    if (sbConfig.anonKey.startsWith('eyJ')) headers.Authorization = 'Bearer ' + sbConfig.anonKey;
    const response = await fetch(sbConfig.url.replace(/\/+$/, '') + '/functions/v1/appwrite-auth-bridge', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        appwriteJwt: token.jwt,
        requestedRole: requestedRole === 'player' ? 'player' : 'follower',
        displayName: user.name || ''
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'تعذر ربط حساب Appwrite ببيانات الدوري. راجع إعداد الدالة الخادمية.');
    window.LeagueDB.adoptSession(result.session || result);
    return result.session || result;
  }

  window.AppwriteAuth = {
    get configured() { return configured; },
    get recoveryPending() {
      const params = new URLSearchParams(location.search);
      return params.get('flow') === 'recovery' && !!(params.get('userId') && params.get('secret'));
    },

    async signUp({ email, password, name, role }) {
      requireReady();
      const user = await account.create({ userId: sdk.ID.unique(), email, password, name });
      await account.createEmailPasswordSession({ email, password });
      localStorage.setItem('appwrite-pending-role:' + email.toLowerCase(), role === 'player' ? 'player' : 'follower');
      await account.createVerification({ url: callbackUrl('verify') });
      return { needsVerification: true, user };
    },

    async sendEmailCode({ email, name, role }) {
      requireReady();
      const generatedUserId = sdk.ID.unique();
      const token = await account.createEmailToken({ userId: generatedUserId, email });
      const userId = token.userId || generatedUserId;
      sessionStorage.setItem('appwrite-email-otp:' + email.toLowerCase(), JSON.stringify({ userId, name: name || '', role: role === 'player' ? 'player' : 'follower' }));
      return { userId, expire: token.expire };
    },

    async verifyEmailCode(email, secret) {
      requireReady();
      const key = 'appwrite-email-otp:' + email.toLowerCase();
      let pending;
      try { pending = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { pending = null; }
      if (!pending?.userId) throw new Error('اطلب كودًا جديدًا من بريدك الإلكتروني أولًا.');
      try {
        await account.deleteSession({ sessionId: 'current' });
      } catch (error) {
        if (error.code !== 401) throw error;
      }
      await account.createSession({ userId: pending.userId, secret });
      let user = await account.get();
      if (pending.name && pending.name.trim() !== user.name) {
        await account.updateName({ name: pending.name });
        user = await account.get();
      }
      await bridgeVerifiedUser(user, pending.role);
      sessionStorage.removeItem(key);
      return window.LeagueDB.session;
    },

    async restoreSession() {
      if (!configured || !window.LeagueDB?.configured) return null;
      try {
        const user = await account.get();
        const currentEmail = window.LeagueDB.session?.user?.email?.toLowerCase();
        if (currentEmail && currentEmail === (user.email || '').toLowerCase()) {
          try { if (await window.LeagueDB.profile()) return window.LeagueDB.session; } catch { /* re-bridge an expired Supabase session */ }
        }
        return await bridgeVerifiedUser(user, 'follower');
      } catch (error) {
        if (error.code === 401) return null;
        throw error;
      }
    },

    async consumeCallbacks() {
      requireReady();
      const params = new URLSearchParams(location.search);
      if (params.get('flow') === 'verify' && params.get('userId') && params.get('secret')) {
        await account.updateVerification({ userId: params.get('userId'), secret: params.get('secret') });
        cleanCallbackUrl();
        return true;
      }
      return false;
    },

    async requestPasswordReset(email) {
      requireReady();
      return account.createRecovery({ email, url: callbackUrl('recovery') });
    },

    async updatePassword(password) {
      requireReady();
      const params = new URLSearchParams(location.search);
      const userId = params.get('userId');
      const secret = params.get('secret');
      if (!userId || !secret || params.get('flow') !== 'recovery') {
        throw new Error('رابط استعادة كلمة المرور غير صالح أو انتهت صلاحيته.');
      }
      await account.updateRecovery({ userId, secret, password, passwordAgain: password });
      cleanCallbackUrl();
    },

    async signOut() {
      if (!configured) return;
      try { await account.deleteSession({ sessionId: 'current' }); }
      catch (error) { if (error.code !== 401) throw error; }
    }
  };
})();

