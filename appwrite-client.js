/* حسابات Appwrite وملفاتها الشخصية مستقلة عن بيانات الدوري المخزنة في Supabase. */
(() => {
  const config = window.LEAGUE_APPWRITE || {};
  const endpoint = String(config.endpoint || '').replace(/\/+$/, '');
  const projectId = String(config.projectId || '');
  const databaseId = String(config.databaseId || '');
  const profilesTableId = String(config.profilesTableId || '');
  const $ = id => document.getElementById(id);
  const dialog = $('appwriteDialog');

  function setNotice(message, isError) {
    const notice = $('appwriteNotice');
    if (!notice) return;
    notice.textContent = message;
    notice.classList.toggle('error', !!isError);
    notice.classList.toggle('success', !isError);
  }

  function ready() {
    return !!(endpoint && projectId && databaseId && profilesTableId);
  }

  async function request(path, options) {
    if (!ready()) throw new Error('أكمل إعداد Appwrite في ملف APPWRITE_SETUP.md أولًا.');
    const opts = options || {};
    const headers = { 'X-Appwrite-Project': projectId, Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(endpoint + '/' + path.replace(/^\/+/, ''), {
      method: opts.method || 'GET',
      credentials: 'include',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    });
    let data = null;
    const raw = await response.text();
    try { data = raw ? JSON.parse(raw) : null; } catch { data = { message: raw }; }
    if (!response.ok) {
      const error = new Error(data && (data.message || data.error) || 'تعذر إكمال طلب Appwrite (' + response.status + ').');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function showForm(mode) {
    $('appwriteAuthForm').classList.remove('hide');
    $('appwriteProfile').classList.add('hide');
    const signup = mode === 'signup';
    $('appwriteNameField').classList.toggle('hide', !signup);
    $('appwriteSubmit').textContent = signup ? 'إنشاء حساب Appwrite' : 'تسجيل الدخول إلى Appwrite';
    $('appwriteMode').textContent = signup ? 'عندي حساب بالفعل — تسجيل الدخول' : 'إنشاء حساب جديد';
    $('appwriteMode').dataset.mode = signup ? 'login' : 'signup';
  }

  function showProfile(user, row) {
    $('appwriteAuthForm').classList.add('hide');
    $('appwriteProfile').classList.remove('hide');
    $('appwriteProfileEmail').textContent = user.email || '';
    $('appwriteDisplayName').value = row.displayName || user.name || '';
    $('appwriteBio').value = row.bio || '';
    setNotice('أنت مسجل الدخول بحساب Appwrite. بيانات الدوري وإدارته تبقى في Supabase.', false);
  }

  function profilePath(userId) {
    return 'tablesdb/' + encodeURIComponent(databaseId) + '/tables/' +
      encodeURIComponent(profilesTableId) + '/rows/' + encodeURIComponent(userId);
  }

  async function getOrCreateProfile(user) {
    try {
      const row = await request(profilePath(user.$id));
      return row.data || {};
    } catch (error) {
      if (error.status !== 404) throw error;
      const permissions = [
        'read("user:' + user.$id + '")',
        'update("user:' + user.$id + '")'
      ];
      const created = await request(
        'tablesdb/' + encodeURIComponent(databaseId) + '/tables/' +
        encodeURIComponent(profilesTableId) + '/rows',
        {
          method: 'POST',
          body: {
            rowId: user.$id,
            data: { displayName: user.name || '', bio: '' },
            permissions
          }
        }
      );
      return created.data || {};
    }
  }

  async function currentAccount() {
    return request('account');
  }

  async function restore() {
    if (!ready()) {
      setNotice('أكمل إعداد Appwrite أولًا. راجع APPWRITE_SETUP.md.', true);
      return;
    }
    try {
      const user = await currentAccount();
      const row = await getOrCreateProfile(user);
      showProfile(user, row);
    } catch (error) {
      if (error.status === 401) {
        showForm('login');
        setNotice('سجّل الدخول بحساب Appwrite أو أنشئ حسابًا جديدًا.', false);
      } else {
        setNotice(error.message, true);
      }
    }
  }

  async function signUp(email, password, name) {
    const userId = (crypto.randomUUID ? crypto.randomUUID() : 'u' + Date.now() + Math.random().toString(36).slice(2))
      .replace(/[^A-Za-z0-9._-]/g, '').slice(0, 36);
    await request('account', {
      method: 'POST',
      body: { userId, email, password, name }
    });
    await signIn(email, password);
  }

  async function signIn(email, password) {
    await request('account/sessions/email', {
      method: 'POST',
      body: { email, password }
    });
    const user = await currentAccount();
    const row = await getOrCreateProfile(user);
    showProfile(user, row);
  }

  $('openAppwriteAccount')?.addEventListener('click', async () => {
    if (dialog && !dialog.open) dialog.showModal();
    await restore();
  });

  $('appwriteClose')?.addEventListener('click', () => dialog?.close());

  $('appwriteMode')?.addEventListener('click', event => {
    showForm(event.currentTarget.dataset.mode || 'signup');
  });

  $('appwriteSubmit')?.addEventListener('click', async () => {
    const button = $('appwriteSubmit');
    const email = $('appwriteEmail').value.trim();
    const password = $('appwritePassword').value;
    const name = $('appwriteName').value.trim();
    const signup = $('appwriteNameField').classList.contains('hide') === false;
    if (!email || !password || (signup && !name)) {
      setNotice('أدخل البريد وكلمة المرور، والاسم عند إنشاء حساب جديد.', true);
      return;
    }
    if (password.length < 8) {
      setNotice('استخدم كلمة مرور من ٨ أحرف على الأقل.', true);
      return;
    }
    button.disabled = true;
    setNotice(signup ? 'جارٍ إنشاء الحساب…' : 'جارٍ تسجيل الدخول…', false);
    try {
      if (signup) await signUp(email, password, name);
      else await signIn(email, password);
      setNotice('تم تسجيل الدخول وحفظ ملفك الشخصي في Appwrite.', false);
    } catch (error) {
      setNotice(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $('appwriteSaveProfile')?.addEventListener('click', async () => {
    const button = $('appwriteSaveProfile');
    const displayName = $('appwriteDisplayName').value.trim();
    const bio = $('appwriteBio').value.trim();
    if (!displayName) {
      setNotice('أدخل اسم العرض قبل الحفظ.', true);
      return;
    }
    button.disabled = true;
    try {
      const user = await currentAccount();
      await request('account/name', { method: 'PATCH', body: { name: displayName } });
      await request(profilePath(user.$id), {
        method: 'PATCH',
        body: { data: { displayName, bio } }
      });
      setNotice('تم حفظ الملف الشخصي في Appwrite.', false);
    } catch (error) {
      setNotice(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $('appwriteSignOut')?.addEventListener('click', async () => {
    try {
      await request('account/sessions/current', { method: 'DELETE' });
      showForm('login');
      setNotice('تم تسجيل الخروج من Appwrite.', false);
    } catch (error) {
      setNotice(error.message, true);
    }
  });

  if (dialog) showForm('login');
})();
