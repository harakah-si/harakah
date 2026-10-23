// harakah.si /privacy/, /terms/ and /support/: static pages, Arabic and English on one page, no scripts, no cookies.
// scripts/build-static.mjs writes them with /tool/'s palette (same shell as the 404 page). Keep them true to the code:
// the site has no accounts or forms, the CLI sends nothing to Harakah, the hosted tool at mcp.harakah.si (mcp/) processes the
// code it's sent in memory and stores nothing, and the only collectors are npm and Cloudflare.
export const UPDATED = "2026-10-22";

const ar = (s) => `<section lang="ar" dir="rtl">${s}</section>`;
const en = (s) => `<section lang="en" dir="ltr">${s}</section>`;

export const PAGES = {
  privacy: {
    title: "Privacy · الخصوصية",
    desc: "What harakah.si, the harakah-fixer tool and the hosted Harakah tool collect: no accounts, no cookies, and code sent to the hosted tool is not stored.",
    body: ar(`<h1>سياسة الخصوصية</h1>
<p class="upd">آخر تحديث: ${UPDATED}</p>
<p>أنا عمرو الإمام، أطوّر حركة وأشغّلها بنفسي. هذي الصفحة تشرح بالضبط وش يوصلني ووش ما يوصلني.</p>
<h2>باختصار</h2>
<ul><li>الموقع ما فيه حسابات ولا نماذج تسجيل ولا كوكيز.</li>
<li>أداة harakah-fixer ومهارة حركة تشتغل على جهازك، وما ترسل ملفاتك ولا أي بيانات لي.</li>
<li>الأداة المستضافة (mcp.harakah.si) تستقبل الكود اللي يرسله لها مساعد الذكاء الاصطناعي، تفحصه أو تصلّحه في الذاكرة، وترجّع النتيجة. ما أخزّن الكود ولا النتيجة ولا أسجّلهم.</li>
<li>الجهات الوحيدة اللي توصلها بيانات تقنية هم Cloudflare (استضافة الموقع والأداة المستضافة) وnpm (تنزيل الحزمة).</li></ul>
<h2>الموقع harakah.si</h2>
<p>الموقع مستضاف على Cloudflare Pages ويستخدم Cloudflare Web Analytics. هذي الإحصائيات ما تستخدم كوكيز، وتحسب زيارات الصفحات بمعلومات مثل الصفحة، والموقع اللي جيت منه، ونوع المتصفح والجهاز، والدولة التقريبية. Cloudflare تعالج عنوان IP وبيانات الطلب عشان تقدّم الموقع وتحميه، حسب <a href="https://www.cloudflare.com/privacypolicy/">سياسة خصوصية Cloudflare</a>.</p>
<p>اختياراتك في الموقع (اللغة، والوضع الفاتح أو الداكن، وشكل الأرقام، والألوان) تنحفظ في متصفحك فقط (localStorage)، وما توصلني.</p>
<h2>الأداة والمهارة</h2>
<p>أوامر <code>npx -y -p harakah-fixer harakah-fix</code> تفحص وتصلّح الملفات على جهازك. الأداة ما فيها تتبّع ولا إحصائيات استخدام، وما ترسل كودك لأي مكان. أول مرة تشغّلها، npx ينزّل الحزمة من سجل npm، وهذا الطلب يوصل لـ npm (التابعة لـ GitHub) بعنوان IP ومعلومات مثل إصدار npm وNode ونظام التشغيل، حسب <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement">بيان خصوصية GitHub</a>.</p>
<p>لما تستخدم المهارة داخل مساعد ذكاء اصطناعي، المحادثة نفسها ومخرجات الأوامر يعالجها مزوّد المساعد حسب سياسته هو، مو حركة.</p>
<h2>الأداة المستضافة (mcp.harakah.si)</h2>
<p>إضافة حركة في ChatGPT وموصّل حركة في Claude (وأي مساعد يدعم MCP) يقدرون يستدعون أداتين مستضافتين: <code>check_arabic</code> و<code>fix_arabic</code>. ما تحتاج حساب ولا تسجيل دخول.</p>
<ul><li><strong>اللي يوصلني:</strong> كود ملف واحد (صفحة HTML أو مكوّن Remotion) يرسله المساعد مع خيارات بسيطة مثل نوع الأرقام. هذا الكود ممكن يحتوي أي نص موجود في ملفك، فلا ترسل ملفات فيها معلومات شخصية أو سرية. ومع كل طلب تشوف Cloudflare بيانات تقنية مثل عنوان IP ووقت الطلب.</li>
<li><strong>الغرض:</strong> فحص النص العربي في الكود وإصلاحه وإرجاع النتيجة للمساعد، بس.</li>
<li><strong>مدة الاحتفاظ:</strong> الكود ينعالج في الذاكرة ويختفي أول ما ترجع النتيجة. ما أخزّنه في قاعدة بيانات أو ملف، وما أسجّله، وسجلات Workers مطفّية. Cloudflare تحتفظ ببيانات الطلب التقنية (مو محتوى الكود) لفترة محدودة عشان الأمان ومنع الإساءة، حسب <a href="https://www.cloudflare.com/privacypolicy/">سياسة خصوصية Cloudflare</a>.</li>
<li><strong>الجهات المستلمة:</strong> Cloudflare فقط، كمعالج يشغّل الأداة على Cloudflare Workers. ما أبيع البيانات ولا أشاركها مع أحد ولا أستخدمها لتدريب نماذج.</li>
<li><strong>تحكّمك:</strong> الأداة ما تشتغل إلا لما يستدعيها المساعد في محادثتك، وتقدر تعطّل الإضافة أو تشغّل أداة harakah-fixer على جهازك بدالها عشان ما يطلع كودك من جهازك. وبما إني ما أخزّن شي، ما عندي بيانات عنك أقدر أعرضها أو أحذفها.</li></ul>
<h2>الأمان</h2>
<p>كل الاتصالات بالموقع والأداة المستضافة مشفّرة بـ HTTPS. الأداة ما تفتح روابط ولا تتصل بأي خدمة ثانية، وما عندها وصول لحساباتك أو ملفاتك، تشوف بس الكود اللي ينرسل لها.</p>
<h2>الأطفال</h2>
<p>حركة أداة للمطوّرين والمصمّمين، وما أجمع بيانات شخصية من أي أحد، ومنهم الأطفال.</p>
<h2>لما تراسلني</h2>
<p>إذا راسلتني على <a href="mailto:hello@harakah.si">hello@harakah.si</a> أو فتحت بلاغ على GitHub، أستخدم اللي ترسله عشان أرد عليك فقط، وما أشاركه مع أحد. البلاغات على GitHub عامة.</p>
<h2>التغييرات والتواصل</h2>
<p>إذا تغيّرت هذي السياسة أحدّث التاريخ فوق. لأي سؤال: <a href="mailto:hello@harakah.si">hello@harakah.si</a>.</p>`) +
    en(`<h1>Privacy policy</h1>
<p class="upd">Last updated: ${UPDATED}</p>
<p>Harakah is built and run by me, Amro Alemam. This page explains exactly what reaches me and what doesn't.</p>
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
<p>The Harakah plugin for ChatGPT, the Harakah connector for Claude and any other MCP client can call two hosted tools, <code>check_arabic</code> and <code>fix_arabic</code>. They need no account or sign-in.</p>
<ul><li><strong>What we receive:</strong> the code of one file (an HTML page or a Remotion component) that the assistant sends, plus simple options such as the digit style. That code can contain any text that's in your file, so don't send files with personal or confidential information. With each request, Cloudflare also sees technical data such as your IP address and the time of the request.</li>
<li><strong>Purpose:</strong> only to check and fix the Arabic text in that code and return the result to the assistant.</li>
<li><strong>Retention:</strong> the code is processed in memory and discarded as soon as the result is returned. We don't save it to a database or file or log it, and Workers logging is turned off. Cloudflare keeps technical request data (not the code itself) for a limited time for security and abuse prevention, under <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare's privacy policy</a>.</li>
<li><strong>Recipients:</strong> only Cloudflare, as the processor that runs the tool on Cloudflare Workers. We don't sell or share the data, and we don't use it to train models.</li>
<li><strong>Your controls:</strong> the tool runs only when the assistant calls it in your conversation. You can turn the plugin off, or run harakah-fixer on your computer instead so your code never leaves it. Because we store nothing, we hold no data about you to show or delete.</li></ul>
<h2>Security</h2>
<p>All connections to the site and the hosted tool are encrypted with HTTPS. The hosted tool doesn't fetch URLs or call any other service, and it has no access to your accounts or files; it only sees the code sent to it.</p>
<h2>Children</h2>
<p>Harakah is a tool for developers and designers. It collects no personal data from anyone, children included.</p>
<h2>When you contact us</h2>
<p>If you email <a href="mailto:hello@harakah.si">hello@harakah.si</a> or open a GitHub issue, we use what you send only to reply, and we don't share it. GitHub issues are public.</p>
<h2>Changes and contact</h2>
<p>If this policy changes, the date above changes with it. Questions: <a href="mailto:hello@harakah.si">hello@harakah.si</a>.</p>`),
  },
  mcp: {
    title: "Connector (MCP) · الموصّل",
    desc: "Use Harakah inside Claude, ChatGPT or any MCP client: one URL, no sign-in, two read-only tools that check and fix Arabic text in Remotion, GSAP and HTML code.",
    body: ar(`<h1>موصّل حركة (MCP)</h1>
<p class="upd">آخر تحديث: ${UPDATED}</p>
<p>تقدر تضيف حركة لـ Claude أو ChatGPT أو أي مساعد يدعم MCP، والمساعد يفحص النص العربي في كودك ويصلّحه قبل ما ترندر. الموصّل مجاني، وما يحتاج حساب ولا تسجيل دخول.</p>
<h2>العنوان</h2>
<p><code>https://mcp.harakah.si/mcp</code></p>
<ul><li><b>Claude:</b> من الإعدادات ← Connectors ← Add custom connector، الصق العنوان، واترك إعدادات OAuth فاضية.</li>
<li><b>ChatGPT:</b> ثبّت إضافة Harakah Arabic Motion، أو أضف العنوان كتطبيق مخصّص في وضع المطوّر.</li>
<li><b>Claude Code:</b> <code>claude mcp add --transport http harakah https://mcp.harakah.si/mcp</code></li>
<li><b>غيرها:</b> أي عميل يدعم Streamable HTTP. ما يحتاج مفاتيح ولا ترويسات خاصة.</li></ul>
<h2>الأداتين</h2>
<ul><li><code>check_arabic</code>: تفحص ملف واحد (صفحة HTML أو GSAP أو HyperFrames، أو مكوّن Remotion) وترجّع كل مشكلة برقم السطر: حروف مفصولة بسبب التقسيم حرف حرف، اتجاه ناقص من اليمين لليسار، خطوط ما فيها عربي، تباعد حروف على نص عربي، أرقام مخلوطة، ارتفاع سطر يقصّ التشكيل، ونص مرسوم حرف حرف على canvas أو 3D.</li>
<li><code>fix_arabic</code>: ترجّع نسخة مصلّحة من نفس الملف. تحافظ على حركة الحروف وحدة وحدة والحروف تبقى متصلة، وتعلّم كل تغيير بتعليق <code>harakah:</code>.</li></ul>
<p>الأداتين للقراءة فقط: ما تعدّل ملفاتك، ترجّع نص بس، والمساعد أو أنت تقرّرون وش تستخدمون منه. خيارات اختيارية: <code>kind</code> (html أو remotion، والافتراضي تحديد تلقائي)، و<code>digits</code> (eastern أو western أو keep)، و<code>split</code> لـ fix_arabic (zwj أو word).</p>
<h2>أمثلة تكتبها للمساعد</h2>
<ul><li>«افحص مكوّن Remotion هذا من مشاكل العربي قبل ما أرندره» والصق المكوّن.</li>
<li>«صلّح العربي في هيرو GSAP SplitText هذا عشان الحروف تبقى متصلة وتتحرك وحدة وحدة.»</li>
<li>«خلّ كل الأرقام في بطاقة العنوان هذي أرقام عربية (١٢٣) واضبط الاتجاه من اليمين لليسار.»</li>
<li>«ليش عنواني العربي يطلع مقطّع في مشهد three.js هذا؟»</li></ul>
<h2>الحدود</h2>
<ul><li>ملف واحد في كل استدعاء، والكود لحد ٢٠٠٬٠٠٠ حرف.</li>
<li>الأداة ما تفتح روابط ولا تقرأ مشروعك، تشوف بس الكود اللي يرسله المساعد. لمشروع كامل أو رندر فعلي، استخدم <a href="/tool/">حركة على جهازك</a>.</li>
<li>لما يستخدم الكود المصلّح مكوّن Remotion المساعد، تحتاج الملف <code>./harakah-arabic</code> من حزمة <code>@harakah/remotion-arabic</code> على npm، أو شغّل <code>npx harakah-fixer fix --write</code> محلياً.</li></ul>
<h2>إذا واجهتك مشكلة</h2>
<ul><li><b>الموصّل ما يتصل:</b> تأكد إن العنوان ينتهي بـ <code>/mcp</code> وإنه https، واترك حقول OAuth فاضية.</li>
<li><b>الأدوات ما تظهر:</b> شغّل الموصّل للمحادثة من قائمة الأدوات، أو افصله ووصّله من جديد.</li>
<li><b>«code must be a non-empty string»:</b> المساعد ما أرسل الكود. الصق الملف نفسه في المحادثة.</li>
<li><b>التحديد التلقائي غلط:</b> اطلب من المساعد يحدّد <code>kind</code> بنفسه (remotion أو html).</li>
<li><b>خطأ 503 أو انقطاع:</b> جرّب بعد شوي، أو استخدم الأداة على جهازك.</li></ul>
<h2>الخصوصية والدعم</h2>
<p>الكود ينعالج في الذاكرة وما أخزّنه ولا أسجّله، والتفاصيل في <a href="/privacy/">سياسة الخصوصية</a>. لأي سؤال راسلني على <a href="mailto:hello@harakah.si">hello@harakah.si</a> أو افتح <a href="https://github.com/harakah-si/harakah/issues">بلاغ على GitHub</a>.</p>`) +
    en(`<h1>Harakah connector (MCP)</h1>
<p class="upd">Last updated: ${UPDATED}</p>
<p>Add Harakah to Claude, ChatGPT or any MCP client, and your assistant can check and fix the Arabic text in your code before you render. It's free, with no account and no sign-in.</p>
<h2>Server URL</h2>
<p><code>https://mcp.harakah.si/mcp</code></p>
<ul><li><b>Claude:</b> Settings → Connectors → Add custom connector, paste the URL, and leave the OAuth fields empty.</li>
<li><b>ChatGPT:</b> install the Harakah Arabic Motion plugin, or add the URL as a custom app in developer mode.</li>
<li><b>Claude Code:</b> <code>claude mcp add --transport http harakah https://mcp.harakah.si/mcp</code></li>
<li><b>Others:</b> any client that supports Streamable HTTP. No keys or special headers needed.</li></ul>
<h2>The two tools</h2>
<ul><li><code>check_arabic</code>: checks one file (an HTML, GSAP or HyperFrames page, or a Remotion component) and reports each problem with its line number: letters split apart by per-letter animation, missing right-to-left direction, Latin-only fonts, letter-spacing on Arabic, mixed digit styles, tight line-height that clips diacritics, and canvas or 3D text drawn letter by letter.</li>
<li><code>fix_arabic</code>: returns a repaired copy of the same file. It keeps your per-letter animation while the letters stay joined, and marks every change with a <code>harakah:</code> comment.</li></ul>
<p>Both tools are read-only: they never change your files and only return text. Optional arguments: <code>kind</code> (html or remotion; auto-detected by default), <code>digits</code> (eastern, western or keep), and for fix_arabic, <code>split</code> (zwj or word).</p>
<h2>Example prompts</h2>
<ul><li>"Check this Remotion component for Arabic problems before I render it:" followed by the component.</li>
<li>"Fix the Arabic in this GSAP SplitText hero so the letters stay connected but still animate one by one."</li>
<li>"Make all the numbers in this HTML title card Eastern Arabic (١٢٣) and set it right-to-left."</li>
<li>"Why does my Arabic title look disconnected in this three.js scene?"</li></ul>
<h2>Limits</h2>
<ul><li>One file per call, up to 200,000 characters of code.</li>
<li>The tool doesn't fetch URLs or read your project; it only sees the code the assistant sends. For a whole project or a real render, use <a href="/tool/">Harakah on your computer</a>.</li>
<li>When fixed Remotion code uses the helper component, you need <code>./harakah-arabic</code> from the <code>@harakah/remotion-arabic</code> npm package, or run <code>npx harakah-fixer fix --write</code> locally.</li></ul>
<h2>Troubleshooting</h2>
<ul><li><b>The connector won't connect:</b> check that the URL is https and ends in <code>/mcp</code>, and leave the OAuth fields empty.</li>
<li><b>The tools don't appear:</b> enable the connector for the chat from the tools menu, or disconnect and reconnect it.</li>
<li><b>"code must be a non-empty string":</b> the assistant didn't send the code. Paste the file itself into the chat.</li>
<li><b>Wrong file type detected:</b> ask the assistant to set <code>kind</code> (remotion or html).</li>
<li><b>503 errors or timeouts:</b> try again shortly, or use the local tool.</li></ul>
<h2>Privacy and support</h2>
<p>Code is processed in memory and never stored or logged; see the <a href="/privacy/">privacy policy</a>. Questions: <a href="mailto:hello@harakah.si">hello@harakah.si</a> or a <a href="https://github.com/harakah-si/harakah/issues">GitHub issue</a>.</p>`),
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
<h2>كيف توصلني</h2>
<ul><li>إيميل: <a href="mailto:hello@harakah.si">hello@harakah.si</a> (عربي أو إنجليزي).</li>
<li>مشكلة أو اقتراح: <a href="https://github.com/harakah-si/harakah/issues">افتح بلاغ على GitHub</a>. البلاغات عامة، فلا تحط فيها شي خاص.</li>
<li>ثغرة أمنية: لا تفتح بلاغ عام، راسل <a href="mailto:security@harakah.si">security@harakah.si</a> (<a href="https://github.com/harakah-si/harakah/blob/main/SECURITY.md">سياسة الأمان</a>).</li></ul>
<h2>عشان أساعدك أسرع</h2>
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
