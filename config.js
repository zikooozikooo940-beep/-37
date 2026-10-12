/* إعداد عام للواجهة بعد إنشاء مشروع Supabase. المفتاح anon عام ومقيّد بسياسات RLS.
   لا تضع هنا service_role أو VAPID_PRIVATE_KEY أو أي كلمة مرور. */
window.LEAGUE_SUPABASE = {
  url: 'https://qqwdvukihmxfugonoixv.supabase.co',
  anonKey: 'sb_publishable_7r9dkcCvWwDOa2bl2Hy0kA_3L40c5se',
  vapidPublicKey: 'BG12_UN2aPJtl6pQvjETP44wn-upqpRbrN2Ess4Mf8F3MmXFmrTY8mg22XuFHB4t-a8fJTiThs7S0Ep9RKMOYG8'
};

window.LEAGUE_APPWRITE = {
  endpoint: 'https://fra.cloud.appwrite.io/v1',
  projectId: '6ab6b317000768639ecc',
  databaseId: 'league-profiles',
  profilesTableId: 'profiles'
};
