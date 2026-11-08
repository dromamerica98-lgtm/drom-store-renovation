# ניהול תקציב שיפוץ החנות

אפליקציית אינטרנט בעברית לניהול תקציב השיפוץ: תחומי עבודה, הצעות מחיר ובחירת ספק, קובצי PDF ותמונות של הצעות, תוספות לחוזה, תשלומים, הוצאות כלליות, רזרבה ותחזית מול תקציב. היא מותאמת לטלפון ורצה על Cloudflare: Workers, D1, R2 ו־Access.

האפיון המלא, כולל כללי החישוב: [docs/SPEC.md](docs/SPEC.md).

## מצב נוכחי: שלבים 1–2 הושלמו

- **שלב 1:** כל המסכים, כללי החישוב עם בדיקות, API ומסד נתונים D1.
- **שלב 2:**
  - **אבטחה:** כל בקשות ה־API מאובטחות ב־Cloudflare Access.
  - **קבצים:** אפשר להעלות, לצפות ולמחוק קובצי PDF ותמונות של הצעות מחיר. הקבצים נשמרים ב־R2 פרטי.
- **שלב 3, עוד לא נעשה:** פריסה. ראו [הגדרות Cloudflare לפני הפריסה](#הגדרות-cloudflare-לפני-הפריסה).

## אבטחה

- **זהות מאומתת בלבד:** כל בקשה ל־`/api/*` חייבת להגיע עם זהות ש־Access אימת. בלי זהות כזו הבקשה נחסמת: 401 כשאין זהות, ו־403 כשהזהות לא תקינה או שייכת לאפליקציה אחרת.
  - **המקור הראשי:** `ctx.access`, הזהות ש־Cloudflare מספק ל־Worker. ה־`aud` שלה חייב להיות שווה ל־`ACCESS_AUD`, והמייל נלקח מ־`getIdentity()`.
  - **גיבוי, כש־`ctx.access` חסר:** ה־JWT שבכותרת `Cf-Access-Jwt-Assertion`. ה־Worker מאמת את החתימה מול המפתחות הציבוריים של הצוות, וגם את ה־issuer ואת ה־audience.
  - **כותרות רגילות:** כותרת כמו `Cf-Access-Authenticated-User-Email` אף פעם לא משמשת כזהות.
- **כשל סגור (fail-closed):** אם `ACCESS_AUD` לא הוגדר, כל בקשה ל־API נחסמת עם שגיאה 500.
- **שמירה ב־R2:**
  - הקבצים נשמרים ב־bucket פרטי, וכל גישה אליהם עוברת דרך ה־Worker ובדיקת הזהות.
  - הסוג נקבע לפי תוכן הקובץ ולא לפי השם. מתקבלים רק PDF, JPEG, PNG, WebP ו־HEIC/HEIF, עד 15MB.
  - שם הקובץ מנוקה מתווים מסוכנים, כולל תווי כיוון שיכולים להסוות סיומת.
- **הגשה לדפדפן:** הקבצים חוזרים לדפדפן עם `Cache-Control: private, no-store` ו־`X-Content-Type-Options: nosniff`.
- **מחיקה:** מחיקת קובץ, הצעה או תחום מוחקת גם את האובייקטים מ־R2.

## הרצה מקומית

דרוש Node.js 22 ומעלה. אין צורך בחשבון Cloudflare או במפתחות: wrangler מריץ D1 ו־R2 מקומית.

```bash
npm install
```

```bash
npm run db:migrate:local
```

```bash
npm run db:seed:local
```

```bash
npm run dev
```

האפליקציה תעלה בכתובת `http://localhost:5173`.

**התחברות בפיתוח:** ההתחברות מדומה דרך הבלוק `access.dev` ב־`wrangler.jsonc`. wrangler מעביר ל־Worker אובייקט `ctx.access` עם המשתמש `dev@localhost`, והקוד עובר באותו נתיב כמו בייצור.
- **משתמש אחר:** שנו את `identity.email` בבלוק.
- **בקשה של מי שלא מחובר:** מחקו את הבלוק.

**איפוס המסד המקומי, כולל הקבצים:** קודם עצרו את שרת הפיתוח, ואז הריצו:

```bash
npm run db:reset:local
```

## בדיקות

```bash
npm test
```

```bash
npm run typecheck
```

## הגדרות Cloudflare לפני הפריסה

אלה הדברים שצריך להגדיר בחשבון Cloudflare. אף אחד מהם הוא לא מפתח סודי, ואין צורך להעביר מפתחות לאיש.

1. **חשבון Cloudflare:** חשבון חינמי מספיק.
2. **מסד הנתונים ואחסון הקבצים:**

   ```bash
   npx wrangler d1 create renovation-db
   ```

   העתיקו את ה־`database_id` שיודפס לבלוק `d1_databases` ב־`wrangler.jsonc`.

   ```bash
   npx wrangler r2 bucket create renovation-files
   ```

   **הקבצים חייבים להישאר פרטיים:** אל תפעילו כתובת `r2.dev` ואל תחברו דומיין ל־bucket.
3. **Cloudflare Zero Trust:**
   - הפעילו את Zero Trust. החבילה החינמית מספיקה עד 50 משתמשים.
   - בחרו שם צוות, וממנו נגזרת כתובת הצוות: `https://<שם>.cloudflareaccess.com`.
   - ודאו ששיטת הכניסה "One-time PIN" (קוד חד־פעמי למייל) פעילה.
4. **הגנת Access על ה־Worker:** אחרי הפריסה הראשונה:
   - ב־Workers & Pages, בחרו את `drom-store-renovation`. ב־Settings, תחת Domains & Routes, הפעילו את Cloudflare Access על כתובת `workers.dev`.
   - ב־"Manage Cloudflare Access", הגדירו מדיניות Allow לכתובות המייל של המשתמשים.
   - העתיקו את ה־**Application Audience (AUD) Tag** של האפליקציה.
5. **משתנים ב־`wrangler.jsonc`, תחת `vars`:**
   - `ACCESS_AUD`: חובה. זה ה־AUD מהשלב הקודם.
   - `ACCESS_TEAM_DOMAIN`: מומלץ. זו כתובת הצוות, ומשמשת לאימות ה־JWT כגיבוי.

   אחרי העדכון צריך לפרוס שוב.
6. **כתובות Preview:** הן כבויות בהגדרות (`preview_urls: false`). אם תפעילו אותן, הפעילו עליהן גם Access.
7. **פריסה:**
   - **דרך GitHub:** חברו את המאגר ב־Workers Builds. פקודת הבנייה היא `npm run build`, ופקודת הפריסה היא `npx wrangler d1 migrations apply renovation-db --remote && npx wrangler deploy`.
   - **מהמחשב:** הריצו `npm run deploy` אחרי `npx wrangler login`.

**אם פורסים לפני שמגדירים את Access:** זה בטוח. ה־API חוסם את כל הבקשות עם שגיאה 500 עד ש־`ACCESS_AUD` מוגדר, ומעטפת האתר עצמה לא מכילה נתונים.

## מבנה הקוד

| תיקייה | תוכן |
|---|---|
| `src/shared` | טיפוסים, המרות מע"מ, כללי החישוב ובדיקותיהם, מגבלות העלאה. משותף לשרת וללקוח |
| `src/worker` | ה־API (Hono על Workers): אימות Access (`access.ts`), קבצים (`files.ts`), אימות נתונים (zod) |
| `src/client` | האפליקציה (React): מסכים, טפסים ועיצוב |
| `migrations` | מבנה מסד הנתונים (D1) |
| `seed` | נתוני דוגמה לפיתוח |

סכומים נשמרים במסד כמספר שלם של אגורות. לכל סכום נשמר סימון מע"מ: כולל, לפני או פטור. ההמרה לבסיס התצוגה שנבחר בהגדרות נעשית בזמן החישוב.
