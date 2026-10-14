# Security policy · سياسة الأمان

## Reporting a vulnerability · الإبلاغ عن ثغرة

Please **don't open a public issue** for a security problem. Email **security@harakah.si** instead, in English or Arabic.

Include what you found, how to reproduce it (a minimal composition, request or command), and what someone could do with it. You'll get a reply within a few days. Once there is a fix, it ships in a new npm release and the CHANGELOG credits you, unless you'd rather not be named.

<div dir="rtl" lang="ar">

لا تفتح بلاغاً عاماً عن مشكلة أمنية. راسلنا على **security@harakah.si** بالعربية أو الإنجليزية، مع وصف المشكلة وطريقة إعادتها وما يمكن أن يفعله بها شخص آخر.

</div>

## What's in scope

- **The web tool** (`harakah-fix serve`, `src/server.ts`): pasted scenes and uploaded projects, the API, and public mode (`HARAKAH_PUBLIC=1`).
- **Code that runs on your machine:** the CLI, the MCP server (`harakah-mcp`), the Claude Code hooks (`harakah-hook`), the Remotion webpack gate (`harakah-fixer/remotion`) and the VS Code extension.
- **The codemod and fixes:** a crafted input that makes `fix --write` write outside the target, or run code from the project it fixes.
- **Renders:** a scene rendered by `compare`, `audit`, `gate --layout`, the MCP server or the web tool that reads a local file outside its project (or a hidden file inside it), lists a folder, or (for a pasted Remotion component) bundles a file from outside its paste. Those are refused by design (`docs/REFERENCE.md`, "What a rendered scene can read on disk"), so a way around it is a vulnerability.

Public mode (`HARAKAH_PUBLIC=1`) is not ready for hosting strangers' code: it refuses to start without `HARAKAH_PUBLIC_UNISOLATED=1`, because there is no per-job isolation yet.

Out of scope: running `harakah-fix fix --write` on a project you don't trust is like running its own build. Prettier, when it formats the fixed files, follows that project's config. Uploads to the web tool are the exception, and are never executed (see `docs/REFERENCE.md`, "Only the tool's own page can use the API").

## Supported versions

Security fixes go into the latest release of `harakah-fixer` on npm.
