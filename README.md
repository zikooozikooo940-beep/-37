# منصة دوري جمعية قاضي عياض

واجهة عربية RTL لموسم كرة القدم. تعمل المعاينة دون اعتماديات عبر `index.html`، مع وضع بيانات محلي للاستخدام دون اتصال بالخدمات.

## التشغيل المحلي

من مجلد المشروع:

```powershell
python -m http.server 4173
```

ثم افتح `http://localhost:4173`. استخدم `localhost` أو HTTPS للمصادقة وإشعارات المتصفح؛ فتح الملف مباشرة عبر `file://` لا يسمح بتسجيل Service Worker.

## ربط Supabase

1. أنشئ مشروع Supabase، ثم شغّل `supabase/schema.sql` وبعده `supabase/public-read-access.sql` من SQL Editor. الملف الثاني يتيح للزوار قراءة النتائج المنشورة عبر عروض محدودة الحقول. ملف `supabase/seed.sql` فارغ عمدًا حتى لا يضيف بيانات بطولة غير مؤكدة.
2. ضع رابط المشروع ومفتاح `anon` العام في `config.js`، أو افتح ⚙ في شارة الاتصال أسفل الصفحة. لا تضع `service_role` في ملفات الموقع.
3. أنشئ حساب المشرف العام من نموذج التسجيل. من SQL Editor، عيّن حسابه الأول يدويًا بعد مراجعة بريده:

```sql
update public.profiles
set role = 'super_admin', status = 'approved', approved_at = now()
where id = (select id from auth.users where email = 'ADMIN_EMAIL');
update public.role_requests
set status = 'approved', reviewer_id = (select id from auth.users where email = 'ADMIN_EMAIL'),
    reviewer_note = 'Initial owner setup', updated_at = now()
where user_id = (select id from auth.users where email = 'ADMIN_EMAIL') and status = 'pending';
```

4. انشر الدوال الخادمية الثلاث:

```powershell
supabase functions deploy review-request
supabase functions deploy send-notification
supabase functions deploy record-result
```

5. لإرسال إشعارات المتصفح، أنشئ مفاتيح VAPID بأداة موثوقة مثل `npx web-push generate-vapid-keys`. ضع المفتاح العام في `config.js`، واحفظ المفتاحين الخاص والعام في أسرار Edge Functions عبر Supabase CLI. أضف `VAPID_SUBJECT` كعنوان `mailto:` للمشرف. لا تضع المفتاح الخاص في الموقع.

صورة اللاعب اختيارية في نموذج التسجيل. إذا اشترط Supabase تأكيد البريد ولم يُنشئ جلسة فورًا، تبقى الصورة المصغرة مؤقتًا في المتصفح نفسه حتى أول دخول بعد التأكيد، ثم تُرفع إلى bucket خاص `league-media`. يلزم الاحتفاظ بسياسات Storage وعمود `avatar_url` في `schema.sql`.

بعد تهيئة Supabase، تكون صفحات النتائج والمعلومات المنشورة متاحة للزوار دون حساب. لوحة الإدارة وتغيير البيانات يتطلبان تسجيل دخول وصلاحية معتمدة. توجد مسارات العميل والخادم للتسجيل ومراجعة الطلبات وتحميل بعض بيانات الدوري، لكنها لم تُتحقق على مشروع حي. مراجعة الطلب تستخدم `review_join_request` لضمان حفظ حالة الحساب والطلب والإشعار الداخلي وسجل المراجعة في معاملة واحدة. لا تعتبر هذا إثباتًا لاكتمال كل وظائف الموقع.

## ما لم يُجهز للنشر الحي بعد

لم يربط المشروع بحساب Supabase فعلي لعدم توفر عنوان المشروع والمفتاح العام، ولم تُنشر Edge Functions أو تُضبط مفاتيح VAPID. لذلك لا يمكن حاليًا تأكيد عمل المصادقة أو قاعدة البيانات أو Push على حساب حي. لا تستخدمه لاستقبال أعضاء قبل إعداد مشروعك وتشغيل SQL ونشر الدوال واختبار سياسات RLS.

هذه واجهة ثابتة وليست مشروع Next.js بعد. لا يوجد بث Realtime؛ الإشعارات داخل الصفحة تستخدم الاستعلام الدوري. لم تُربط كل إدارة الصور أو بطاقات اللاعبين أو التصويت برجل المباراة بعمليات قاعدة البيانات بعد. بيانات المعاينة تحفظ في `localStorage` وتبقى تجريبية. يمكن نشرها للمعاينة فقط؛ استقبال أعضاء حقيقيين يتطلب مشروع Supabase واختبارًا عمليًا. سبب رفض طلب الانضمام يظهر لصاحبه بعد تشغيل المخطط المحدّث ونشر `review-request`.

راجع [PUBLISH.md](PUBLISH.md) لخطوات نشر المعاينة وقائمة متطلبات تشغيل التسجيل الحقيقي.

## الملفات

- `index.html`, `styles.css`, `app.js`: الواجهة وتجربة المعاينة.
- `config.js`, `supabase-client.js`: إعداد العميل واتصال Auth وPostgREST وEdge Functions.
- `public/images/logo.css`: شعار الجمعية المرفق، مضمّن داخل CSS ليُحزم مع الموقع.
- `service-worker.js`: استقبال إشعارات Web Push.
- `supabase/schema.sql`, `supabase/seed.sql`: مخطط PostgreSQL وسياسات RLS وبيانات اختبار اختيارية.
- `supabase/functions/`: دوال مراجعة الطلبات وإرسال الإشعارات.
- `netlify.toml`: إعداد نشر ثابت اختياري على Netlify.
- `prepare-publish.cjs`: تجهيز ملفات الواجهة فقط داخل `dist` قبل النشر.
- `PUBLISH.md`: خطوات النشر ومتطلبات تشغيل التسجيل الحقيقي.
