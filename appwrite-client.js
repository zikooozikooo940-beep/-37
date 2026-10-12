/* حسابات Appwrite وملفاتها الشخصية مستقلة عن بيانات الدوري المخزنة في Supabase. */
(() => {
  const config = window.LEAGUE_APPWRITE || {};
  const sdk = window.Appwrite;
  const $ = id => document.getElementById(id);
  const dialog = $('appwriteDialog');
  const sdkReady = !!(sdk && config.endpoint && config.projectId && config.databaseId && config.profilesTableId);
  let account;
  let tablesDB;

  if (sdkReady) {
    const client = new sdk.Client()
      .setEndpoint(config.endpoint)
      .setProject(config.projectId);
    account = new sdk.Account(client);
    tablesDB = new sdk.TablesDB(client);
  }

  function setNotice(message, isError) {
    const notice = $('appwriteNotice');
    if (!notice) return;
    notice.textContent = message;
    notice.classList.toggle('error', !!isError);
    notice.classList.toggle('success', !isError);
  }

  function requireSdk() {
    if (!sdkReady) throw new Error('تعذر تحميل Appwrite SDK أو لم تكتمل الإعدادات. راجع APPWRITE_SETUP.md.');
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

  async function getOrCreateProfile(user) {
    try {
      const row = await tablesDB.getRow({
        databaseId: config.databaseId,
        tableId: config.profilesTableId,
        rowId: user.$id
      });
      return row.data || {};
    } catch (error) {
      if (error.code !== 404) throw error;
      const row = await tablesDB.createRow({
        databaseId: config.databaseId,
        tableId: config.profilesTableId,
        rowId: user.$id,
        data: { displayName: user.name || '', bio: '' },
        permissions: [
          sdk.Permission.read(sdk.Role.user(user.$id)),
          sdk.Permission.update(sdk.Role.user(user.$id))
        ]
      });
      return row.data || {};
    }
  }

  async function restore() {
    try {
      requireSdk();
      const user = await account.get();
      const row = await getOrCreateProfile(user);
      showProfile(user, row);
    } catch (error) {
      if (error.code === 401) {
        showForm('login');
        setNotice('سجّل الدخول بحساب Appwrite أو أنشئ حسابًا جديدًا.', false);
      } else {
        setNotice(error.message, true);
      }
    }
  }

  async function signUp(email, password, name) {
    await account.create({
      userId: sdk.ID.unique(),
      email,
      password,
      name
    });
    await signIn(email, password);
  }

  async function signIn(email, password) {
    await account.createEmailPasswordSession({ email, password });
    const user = await account.get();
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
    const signup = !$('appwriteNameField').classList.contains('hide');
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
      requireSdk();
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
      requireSdk();
      const user = await account.get();
      await account.updateName({ name: displayName });
      await tablesDB.updateRow({
        databaseId: config.databaseId,
        tableId: config.profilesTableId,
        rowId: user.$id,
        data: { displayName, bio }
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
      requireSdk();
      await account.deleteSession({ sessionId: 'current' });
      showForm('login');
      setNotice('تم تسجيل الخروج من Appwrite.', false);
    } catch (error) {
      setNotice(error.message, true);
    }
  });

  if (dialog) showForm('login');
})();
