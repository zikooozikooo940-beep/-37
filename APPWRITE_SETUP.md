# إعداد تسجيل الدخول عبر Appwrite

يستخدم الموقع Appwrite لتسجيل الحسابات والدخول وتأكيد البريد، ثم يتحقق خادميًا من حساب Appwrite وينشئ جلسة Supabase لبيانات الدوري. لا يوضع أي مفتاح سري في المتصفح. دور `super_admin` يبقى محفوظًا في `public.profiles` داخل Supabase.

## 1. إعداد منصة Appwrite

في Appwrite Console افتح المشروع `6ab6b317000768639ecc` ثم **Settings → Platforms → Add platform → Web**. أضف المضيف:

- `zikooozikooo940-beep.github.io` للموقع المنشور.
- `localhost` للتطوير المحلي.

فعّل **Email/Password** وميزة تأكيد البريد من **Auth → Settings**.

## 2. نشر جسر الدخول الآمن

من جذر المستودع، اربط Supabase وانشر الدالة:

```powershell
supabase link --project-ref qqwdvukihmxfugonoixv
supabase secrets set APPWRITE_ENDPOINT=https://fra.cloud.appwrite.io/v1 APPWRITE_PROJECT_ID=6ab6b317000768639ecc
supabase functions deploy appwrite-auth-bridge
```

تستخدم الدالة متغيرات Supabase الخادمية `SUPABASE_URL` و`SUPABASE_ANON_KEY` و`SUPABASE_SERVICE_ROLE_KEY` من بيئة Supabase. لا تضع `service_role` في GitHub أو ملفات الموقع، ولا ترسله في المحادثة. إعداد `verify_jwt = false` لهذه الدالة مقصود: الدالة تتحقق بنفسها من JWT صادر عن Appwrite قبل إصدار جلسة الدوري.

الدالة لا تغيّر دور أو حالة أي ملف موجود. إذا كان حساب البريد موجودًا ومعتمدًا كـ `super_admin` في Supabase، يبقى كما هو. الحساب الجديد يُنشأ كطلب عضو عادي بانتظار الموافقة.

## 3. حساب المدير الحالي

أنشئ حساب Appwrite بالبريد نفسه المرتبط بحساب المدير في Supabase، ثم أكّد البريد من رسالة Appwrite. عند أول تسجيل دخول، يربط الجسر الحسابين بالبريد المؤكّد. بعد ذلك سجّل الخروج والدخول من الموقع.

## 4. الملفات الشخصية في Appwrite (اختياري)

إذا أردت تفعيل محرر الملف الشخصي، أنشئ قاعدة بيانات بالمعرّف `league-profiles` وجدولًا بالمعرّف `profiles`، ثم عمودي `displayName` (نص مطلوب) و`bio` (نص اختياري). فعّل **Row security**، وامنح دور **Users** صلاحية **Create** فقط على الجدول. لا تمنح قراءة أو تحديث عامة؛ التطبيق يضع صلاحيات كل صف لصاحبه.

تسجيل الدخول الأساسي لا يعتمد على هذا الجدول.
