// harakah.si /privacy/, /terms/ and /support/: static pages, Arabic and English on one page, no scripts, no cookies.
// scripts/build-static.mjs writes them with /tool/'s palette (same shell as the 404 page). Keep them true to the code:
// the site has no accounts or forms, the CLI sends nothing to Harakah, the hosted tool at mcp.harakah.si (mcp/) processes the
// code it's sent in memory and stores nothing, and the only collectors are npm and Cloudflare.
export const UPDATED = "2026-10-21";

const ar = (s) => `<section lang="ar" dir="rtl">${s}</section>`;
const en = (s) => `<section lang="en" dir="ltr">${s}</section>`;

export const PAGES = {
  privacy: {
    title: "Privacy · الخصوصية",
    desc: "What harakah.si, the harakah-fixer tool and the hosted Harakah tool collect: no accounts, no cookies, and code sent to the hosted tool is not stored.",
    body: ar(`<h1>سياسة الخصوصية</h1>
<p class="upd">آخر تحديث: ${UPDATED}</p>
<h2>باختصار</h2>
<ul><li>الموقع ما فيه حسابات ولا نماذج تسجيل ولا كوكيز.</li>
<li>أداة harakah-fixer ومهارة حركة تشتغل على جهازك، وما ترسل ملفاتك ولا أي بيانات لحركة.</li>
<li>الأداة المستضافة (mcp.harakah.si) تستقبل الكود اللي يرسله لها مساعد الذكاء الاصطناعي، تفحصه أو تصلّحه في الذاكرة، وترجّع النتيجة. ما نخزّن الكود ولا النتيجة ولا نسجّلهم.</li>
<li>الجهات الوحيدة اللي توصلها بيانات تقنية هم Cloudflare (استضافة الموقع والأداة المستضافة) وnpm (تنزيل الحزمة).</li></ul>
<h2>الموقع harakah.si</h2>
<p>الموقع مستضاف على Cloudflare Pages ويستخدم Cloudflare Web Analytics. هذي الإحصائيات ما تستخدم كوكيز، وتحسب زيارات الصفحات بمعلومات مثل الصفحة، والموقع اللي جيت منه، ونوع المتصفح والجهاز، والدولة التقريبية. Cloudflare تعالج عنوان IP وبيانات الطلب عشان تقدّم الموقع وتحميه، حسب <a href="https://www.cloudflare.com/privacypolicy/">سياسة خصوصية Cloudflare</a>.</p>
<p>اختياراتك في الموقع (اللغة، والوضع الفاتح أو الداكن، وشكل الأرقام، والألوان) تنحفظ في متصفحك فقط (localStorage)، وما توصلنا.</p>
<h2>الأداة والمهارة</h2>
<p>أوامر <code>npx -y -p harakah-fixer harakah-fix</code> تفحص وتصلّح الملفات على جهازك. الأداة ما فيها تتبّع ولا إحصائيات استخدام، وما ترسل كودك لأي مكان. أول مرة تشغّلها، npx ينزّل الحزمة من سجل npm، وهذا الطلب يوصل لـ npm (التابعة لـ GitHub) بعنوان IP ومعلومات مثل إصدار npm وNode ونظام التشغيل، حسب <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement">بيان خصوصية GitHub</a>.</p>
<p>لما تستخدم المهارة داخل مساعد ذكاء اصطناعي، المحادثة نفسها ومخرجات الأوامر يعالجها مزوّد المساعد حسب سياسته هو، مو حركة.</p>
<h2>الأداة المستضافة (mcp.harakah.si)</h2>
<p>إضافة حركة في مساعدات الذكاء الاصطناعي تقدر تستدعي أداتين مستضافتين: <code>check_arabic</code> و<code>fix_arabic</code>. ما تحتاج حساب ولا تسجيل دخول.</p>
<ul><li><strong>اللي يوصلنا:</strong> كود ملف واحد (صفحة HTML أو مكوّن Remotion) يرسله المساعد مع خيارات بسيطة مثل نوع الأرقام. هذا الكود ممكن يحتوي أي نص موجود في ملفك، فلا ترسل ملفات فيها معلومات شخصية أو سرية. ومع كل طلب تشوف Cloudflare بيانات تقنية مثل عنوان IP ووقت الطلب.</li>
<li><strong>الغرض:</strong> فحص النص العربي في الكود وإصلاحه وإرجاع النتيجة للمساعد، بس.</li>
<li><strong>مدة الاحتفاظ:</strong> الكود ينعالج في الذاكرة ويختفي أول ما ترجع النتيجة. ما نخزّنه في قاعدة بيانات أو ملف، وما نسجّله، وسجلات Workers مطفّية. Cloudflare تحتفظ ببيانات الطلب التقنية (مو محتوى الكود) لفترة محدودة عشان الأمان ومنع الإساءة، حسب <a href="https://www.cloudflare.com/privacypolicy/">سياسة خصوصية Cloudflare</a>.</li>
<li><strong>الجهات المستلمة:</strong> Cloudflare فقط، كمعالج يشغّل الأداة على Cloudflare Workers. ما نبيع البيانات ولا نشاركها مع أحد ولا نستخدمها لتدريب نماذج.</li>
<li><strong>تحكّمك:</strong> الأداة ما تشتغل إلا لما يستدعيها المساعد في محادثتك، وتقدر تعطّل الإضافة أو تشغّل أداة harakah-fixer على جهازك بدالها عشان ما يطلع كودك من جهازك. وبما إننا ما نخزّن شي، ما عندنا بيانات عنك نقدر نعرضها أو نحذفها.</li></ul>
<h2>لما تراسلنا</h2>
<p>إذا راسلتنا على <a href="mailto:hello@harakah.si">hello@harakah.si</a> أو فتحت بلاغ على GitHub، نستخدم اللي ترسله عشان نرد عليك فقط. البلاغات على GitHub عامة.</p>
<h2>التغييرات والتواصل</h2>
<p>إذا تغيّرت هذي السياسة نحدّث التاريخ فوق. لأي سؤال: <a href="mailto:hello@harakah.si">hello@harakah.si</a>.</p>`) +
    en(`<h1>Privacy policy</h1>
<p class="upd">Last updated: ${UPDATED}</p>
<h2>In short</h2>
<ul><li>The site has no accounts, no sign-up forms and no cookies.</li>
<li>The harakah-fixer tool and the Harakah skill run on your computer. They don't send your files or any data to Harakah.</li>
<li>The hosted tool (mcp.harakah.si) receives the code an AI assistant sends it, checks or fixes it in memory and returns the result. We don't store or log the code or the result.</li>
<li>The only parties that receive technical data are Cloudflare (which hosts the site and the hosted tool) and npm (which serves the package).</li></ul>
<h2>The harakah.si website</h2>
<p>The site is hosted on Cloudflare Pages and uses Cloudflare Web Analytics. It sets no cookies and counts page views using details such as the page, the referring site, browser and device type, and approximate country. Cloudflare processes your IP address and request data to serve and protect the site, under <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare's privacy policy</a>.</p>
<p>Your choices on the site (language, light or dark theme, digit style and palette) are saved only in your browser (localStorage) and never sent to us.</p>
<h2>The tool and the skill</h2>
<p><code>npx -y -p harakah-fixer harakah-fix</code> commands check and fix files on your computer. The tool has no tracking or usage analytics and doesn't upload your code anywhere. The first time you run it, npx downloads the package from the npm registry. That request reaches npm (part of GitHub) with your IP address and details such as your npm, Node.js and OS versions, under <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement">GitHub's privacy statement</a>.</p>
<p>When you use the skill inside an AI assistant, the conversation and the command output are handled by that assistant's provider under its own policies, not by Harakah.</p>
<h2>The hosted tool (mcp.harakah.si)</h2>
<p>The Harakah plugin for AI assistants can call two hosted tools, <code>check_arabic</code> and <code>fix_arabic</code>. They need no account or sign-in.</p>
<ul><li><strong>What we receive:</strong> the code of one file (an HTML page or a Remotion component) that the assistant sends, plus simple options such as the digit style. That code can contain any text that's in your file, so don't send files with personal or confidential information. With each request, Cloudflare also sees technical data such as your IP address and the time of the request.</li>
<li><strong>Purpose:</strong> only to check and fix the Arabic text in that code and return the result to the assistant.</li>
<li><strong>Retention:</strong> the code is processed in memory and discarded as soon as the result is returned. We don't save it to a database or file or log it, and Workers logging is turned off. Cloudflare keeps technical request data (not the code itself) for a limited time for security and abuse prevention, under <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare's privacy policy</a>.</li>
<li><strong>Recipients:</strong> only Cloudflare, as the processor that runs the tool on Cloudflare Workers. We don't sell or share the data, and we don't use it to train models.</li>
<li><strong>Your controls:</strong> the tool runs only when the assistant calls it in your conversation. You can turn the plugin off, or run harakah-fixer on your computer instead so your code never leaves it. Because we store nothing, we hold no data about you to show or delete.</li></ul>
<h2>When you contact us</h2>
<p>If you email <a href="mailto:hello@harakah.si">hello@harakah.si</a> or open a GitHub issue, we use what you send only to reply. GitHub issues are public.</p>
<h2>Changes and contact</h2>
<p>If this policy changes, the date above changes with it. Questions: <a href="mailto:hello@harakah.si">hello@harakah.si</a>.</p>`),
  },
  terms: {
    title: "Terms · الشروط",
    desc: "Terms for harakah.si, the harakah-fixer tool and the Harakah skill: open source under the MIT license, provided as is.",
    body: ar(`<h1>شروط الاستخدام</h1>
<p class="upd">آخر تحديث: ${UPDATED}</p>
<h2>الرخصة</h2>
<p>حركة (حزمة harakah-fixer، والمهارة، وكود الموقع) مفتوحة المصدر تحت <a href="https://github.com/harakah-si/harakah/blob/main/LICENSE">رخصة MIT</a>. تقدر تستخدمها وتعدّلها وتوزّعها حسب الرخصة.</p>
<h2>بدون ضمان</h2>
<p>حركة مقدّمة «كما هي» بدون أي ضمان. الفحص والإصلاح يساعدونك تلقى المشاكل، وما يضمنون إن كل نص عربي بيطلع صح في كل متصفح أو محرّك رندر. راجع النتيجة قبل ما تنشرها.</p>
<h2>مسؤوليتك</h2>
<ul><li>الأوامر تعدّل ملفات في مشروعك لما تطلب منها (مثل <code>fix --write</code>). استخدم git أو نسخة احتياطية، وشغّلها على مشاريع تثق فيها، لأن تشغيلها مثل تشغيل أدوات البناء في المشروع.</li>
<li>الخطوط لها رخصها الخاصة. حركة تقترح خطوط برخصة OFL، وأي خط ثاني تستخدمه مسؤوليتك تتأكد من رخصته.</li>
<li>لما تستخدم المهارة داخل مساعد ذكاء اصطناعي، تنطبق عليك شروط ذاك المساعد كمان.</li></ul>
<h2>التغييرات والتواصل</h2>
<p>ممكن نحدّث هذي الشروط، ونغيّر التاريخ فوق لما نسوي. لأي سؤال: <a href="mailto:hello@harakah.si">hello@harakah.si</a>.</p>`) +
    en(`<h1>Terms of use</h1>
<p class="upd">Last updated: ${UPDATED}</p>
<h2>License</h2>
<p>Harakah (the harakah-fixer package, the skill and this site's code) is open source under the <a href="https://github.com/harakah-si/harakah/blob/main/LICENSE">MIT license</a>. You can use, change and share it under that license.</p>
<h2>No warranty</h2>
<p>Harakah is provided "as is", without warranty of any kind. Its checks and fixes help you find problems; they don't guarantee that every piece of Arabic text renders correctly in every browser or renderer. Review the result before you publish it.</p>
<h2>Your responsibility</h2>
<ul><li>Commands change files in your project when you ask them to (for example <code>fix --write</code>). Use git or a backup, and run them on projects you trust, since running them is like running that project's own build tools.</li>
<li>Fonts have their own licenses. Harakah suggests OFL-licensed fonts; checking the license of any other font you use is up to you.</li>
<li>When you use the skill inside an AI assistant, that assistant's terms apply too.</li></ul>
<h2>Changes and contact</h2>
<p>These terms may be updated; the date above changes when they are. Questions: <a href="mailto:hello@harakah.si">hello@harakah.si</a>.</p>`),
  },
  support: {
    title: "Support · الدعم",
    desc: "Get help with harakah-fixer and the Harakah skill: email hello@harakah.si or open an issue on GitHub.",
    body: ar(`<h1>الدعم</h1>
<h2>كيف توصلنا</h2>
<ul><li>إيميل: <a href="mailto:hello@harakah.si">hello@harakah.si</a> (عربي أو إنجليزي).</li>
<li>مشكلة أو اقتراح: <a href="https://github.com/harakah-si/harakah/issues">افتح بلاغ على GitHub</a>. البلاغات عامة، فلا تحط فيها شي خاص.</li>
<li>ثغرة أمنية: لا تفتح بلاغ عام، راسل <a href="mailto:security@harakah.si">security@harakah.si</a> (<a href="https://github.com/harakah-si/harakah/blob/main/SECURITY.md">سياسة الأمان</a>).</li></ul>
<h2>عشان نساعدك أسرع</h2>
<ul><li>إصدار الأداة (<code>npx -y -p harakah-fixer harakah-fix --version</code>) وإصدار Node.js.</li>
<li>الأمر اللي شغّلته والمخرج كامل.</li>
<li>أصغر مثال يعيد المشكلة: ملف أو مكوّن فيه النص العربي.</li></ul>
<h2>مشاكل شائعة</h2>
<ul><li><b>الأوامر ما تشتغل:</b> الأداة تحتاج Node.js 22.12 أو أحدث، واتصال بالإنترنت أول مرة عشان npx ينزّل الحزمة.</li>
<li><b>المقارنة أو الرندر يفشل:</b> خطوات compare وaudit والفحص مع <code>--layout</code> تحتاج Chrome أو Chromium على الجهاز.</li>
<li><b>المهارة ما تظهر:</b> المهارة تشغّل أوامر على جهازك، فتشتغل في التطبيقات اللي تنفّذ أوامر محلية فقط.</li></ul>
<p>الدليل الكامل: <a href="https://github.com/harakah-si/harakah#readme">README</a> و<a href="/tool/">شغّل حركة على جهازك</a>.</p>`) +
    en(`<h1>Support</h1>
<h2>How to reach us</h2>
<ul><li>Email: <a href="mailto:hello@harakah.si">hello@harakah.si</a> (English or Arabic).</li>
<li>Bugs and ideas: <a href="https://github.com/harakah-si/harakah/issues">open a GitHub issue</a>. Issues are public, so leave out anything private.</li>
<li>Security problems: don't open a public issue; email <a href="mailto:security@harakah.si">security@harakah.si</a> (<a href="https://github.com/harakah-si/harakah/blob/main/SECURITY.md">security policy</a>).</li></ul>
<h2>To help us help you faster</h2>
<ul><li>The tool version (<code>npx -y -p harakah-fixer harakah-fix --version</code>) and your Node.js version.</li>
<li>The command you ran and its full output.</li>
<li>The smallest example that shows the problem: a file or component with the Arabic text.</li></ul>
<h2>Common problems</h2>
<ul><li><b>Commands don't run:</b> the tool needs Node.js 22.12 or later, and network access the first time so npx can download the package.</li>
<li><b>Compare or render steps fail:</b> compare, audit and <code>gate --layout</code> need Chrome or Chromium on the computer.</li>
<li><b>The skill doesn't show up:</b> it runs commands on your computer, so it only works in apps that can run local commands.</li></ul>
<p>Full guide: the <a href="https://github.com/harakah-si/harakah#readme">README</a> and <a href="/tool/">Run Harakah on your computer</a>.</p>`),
  },
};
