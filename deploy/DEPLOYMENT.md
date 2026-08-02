# איך מעדכנים את האפליקציה בשרת החברה

מסמך ייחוס — לכל סשן/מפתח שצריך להבין איך פריסה עובדת כאן, בלי לשחזר את הידע מאפס.

## התמונה הגדולה

```
עבודה מקומית  →  git commit + tag + push  →  GitHub  →  UPDATE.ps1 בשרת מושך את התג
```

- **הפריסה מבוססת git tags, לא branch.** `UPDATE.ps1` מריץ `git tag --sort=-v:refname | Select -First 1` ומביא את התג העדכני ביותר — לא את `main` HEAD. **קומיט בלי תג לא ייפרס לעולם.**
- כל פיצ'ר/תיקון = קומיט + `git tag -a vX.Y.Z` + `git push origin main --tags`.
- `package.json` version חייב להתעדכן בכל תג — `/api/version` קורא אותו ישירות (לא סומך על VERSION.txt, ראה "שיעורים" למטה).

## מבנה בשרת

```
C:\quote-system\              ← ה-checkout, מנוהל ע"י Scheduled Task בשם QuoteSystemServer (רץ כ-SYSTEM)
C:\quote-system\deploy\UPDATE.ps1
C:\quote-system-backups\      ← גיבויי DB (מחוץ ל-repo בכוונה — לא נמחק ב-reinstall)
C:\quote-system-uploads-backup\
C:\quote-system-logs\         ← תמליל (transcript) של כל הרצת UPDATE.ps1, 20 אחרונות
```

הפורט הוא **3000**. השרת רץ תחת Scheduled Task בשם `QuoteSystemServer`, כ-**SYSTEM**, ומוגדר אוטומטית מחדש בכל פריסה (`Ensure-Task-Configured` ב-`UPDATE.ps1`).

## שתי דרכים להריץ עדכון

### 1. מהממשק (מומלץ, שוטף)
טאב **אודות** → כפתור **"עדכן עכשיו"**. רץ בשקט (בלי חלון), עם מסך ספירה לאחור בצד המשתמש, ורענון אוטומטי בסיום. דורש admin.

בפועל זה קורא ל-`POST /api/admin/update` ב-`src/routes/update.js`, שמשגר את `UPDATE.ps1` כתהליך detached.

### 2. ידנית ב-RDP (לפתרון תקלות)
```powershell
cd C:\quote-system\deploy
.\UPDATE.ps1
```
אפשר גם לגלגל לגרסה ספציפית: `.\UPDATE.ps1 -Version v1.0.15`

## מה `UPDATE.ps1` עושה, בסדר הזה

1. מגבה `database.sqlite` (גם לתוך ה-repo וגם ל-`C:\quote-system-backups\` שמחוץ אליו)
2. מגבה `uploads\quote-attachments`
3. **עוצר את השרת** — כולל הריגת כל תהליך שמאזין על 3000, לא רק מה שה-Task מכיר (ראה "שיעורים")
4. **בודק שהפורט באמת התפנה** — אם לא, עוצר כאן ומחזיר את הגרסה הקודמת לאוויר, בלי לגעת ב-checkout
5. `git reset --hard` + `git clean -fd` (בלי `-x`!) — מנקה שינויים מקומיים והתנגשויות עם קבצים untracked, **בלי לגעת** בקבצים מוגני `.gitignore` (`database.sqlite`, `uploads/`, `backups/`, `VERSION.txt`, `node_modules/`)
6. `git checkout <תג>`
7. `npm install` (שורש + `sign-smart-quote`), `npm run build`
8. כותב `VERSION.txt` (עם התג ש-git בפועל checkout-ל, לא מה שהתבקש — ראה "שיעורים")
9. מפעיל מחדש את המשימה
10. **מאמת ע"י `/api/version`** שהגרסה הרצה היא באמת זו שביקשנו (לא רק "מישהו עונה 200")
11. אם נכשל — **rollback אוטומטי** לגרסה הקודמת, גם הוא מאומת באותו אופן

## דיבוג

- **לוגים:** `C:\quote-system-logs\update-<timestamp>.log` — תמליל מלא של כל הרצה, 20 אחרונות נשמרות
- **גרסה רצה כרגע:** טאב אודות בממשק, או `GET /api/version`
- **בדיקות אוטומטיות:** `deploy/test-stop-server.ps1` ו-`deploy/test-clean-safety.ps1` — מריצים תרחישי כשל אמיתיים (זומבי על הפורט, קובץ untracked חוסם checkout) נגד הקוד האמיתי, לא עותק. שווה להריץ אחרי כל שינוי ב-`UPDATE.ps1`.

## שיעורים מכאובים (למה זה בנוי ככה)

כל אחד מהסעיפים האלה תוקן אחרי שהוא **קרה בפועל** בשרת הזה:

- **תהליך "זומבי" תפס את הפורט** — node שהופעל ידנית פעם אחת שרד כל פריסה, כי `Stop-ScheduledTask` עוצר רק מה שה-Task עצמו הפעיל. השרת הישן המשיך לענות (כולל מגיש את ה-dist החדש שנבנה!) בזמן שהריץ קוד API ישן. הבדיקה שאחרי הפריסה עברה כי היא רק בדקה "מישהו ענה 200". **התיקון:** עצירה הורגת כל דבר על :3000, והבדיקה מוודאת התאמת גרסה דרך `/api/version`, לא רק קוד תגובה.
- **`git checkout` נכשל על קובץ untracked** — קובץ שהועתק ידנית לשרת (`deploy/test-stop-server.ps1`) התנגש עם אותו נתיב בתג החדש. `reset --hard` לא עוזר לקבצים untracked. **התיקון:** `git clean -fd` לפני ה-checkout, בלי `-x` כדי לא לגעת בקבצים המוגנים.
- **`VERSION.txt` דיווח תג ישן ליד commit חדש** — הסקריפט רשם את התג *שהתבקש*, לא את מה שבאמת נבדק ב-checkout; וגם BOM שכתבה PowerShell שבר את ה-JSON.parse בשקט. **התיקון:** `git describe --tags --exact-match HEAD` בפועל, וכתיבה בלי BOM. תצוגת הגרסה במסך אודות מגיעה מ-`package.json` (שחי בתוך ה-checkout ולכן לא יכול לסתור את הקוד הרץ), לא מ-`VERSION.txt`.
- **`dubious ownership` כשה-UI מפעיל את הסקריפט** — הרצה ידנית עבדה (Administrator, בעל ה-repo), אבל דרך הממשק זה SYSTEM (משתמש אחר), וגit מסרב לגעת ב-repo של מישהו אחר. **התיקון:** `safe.directory=*` דרך משתני סביבה, גם ב-`update.js` וגם ב-`UPDATE.ps1`.
- **`npm install` מלכלך את `package-lock.json` בכל פריסה** — שומר git-status-מלוכלך הפך לחסימה קבועה של כל עדכון עתידי אחרי שהוסר ה-`reset --hard`. **התיקון:** במקום לחסום על עץ מלוכלך, פשוט מתעדים מה נזרק ומריצים בכל זאת.

## הערות נוספות

- **SMTP וכל שאר ה-credentials (Morning/Monday/GreenAPI) הם per-environment** — ה-DB בשרת נפרד לגמרי מכל DB מקומי. אחרי כל reinstall מאפס (לא עדכון רגיל) צריך להזין מחדש דרך הממשק.
- **התחברות היא כעת לפי אימייל, לא שם משתמש (מ-v1.0.21)** — לכל משתמש פעיל בשרת חייבת להיות כתובת מייל, אחרת הוא לא יוכל להתחבר כלל.
- אם משהו נכשל בשרת ואין תג קודם רשום — הסקריפט לא יכול לגלגל אחורה אוטומטית ומפעיל את השרת "כמו שהוא" כדי שלפחות **משהו** יענה, במקום להשאיר פרודקשן מת.
