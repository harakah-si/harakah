// Runs inside VS Code (see run.mjs). Plain assert, no test framework: each step logs, the first failure rejects.
"use strict";
const vscode = require("vscode");
const assert = require("assert");
const path = require("path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms = 90000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}
const mine = (uri) => vscode.languages.getDiagnostics(uri).filter((d) => d.source === "Harakah");
const step = (s) => console.log(`[harakah e2e] ${s}`);

exports.run = async function run() {
  const ws = process.env.HARAKAH_E2E_WS;
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "harakah-vscode");
  assert.ok(ext, "extension loaded");

  // 1. HTML: diagnostics on open, a quick fix offered
  const html = vscode.Uri.file(path.join(ws, "page.html"));
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(html));
  const hd = await until("HTML diagnostics", () => mine(html).length && mine(html));
  assert.ok(hd.some((d) => d.code === "HZ07"), `HZ07 on the letter-spaced title: ${hd.map((d) => d.code)}`);
  assert.equal(hd.find((d) => d.code === "HZ07").range.start.line, 1, "diagnostic on the <h1> line");
  const hActs = await vscode.commands.executeCommand("vscode.executeCodeActionProvider", html, hd[0].range);
  assert.ok(hActs.some((a) => /Harakah: fix this file/.test(a.title)), `HTML quick fix: ${hActs.map((a) => a.title)}`);
  step(`HTML: ${hd.length} diagnostics (${[...new Set(hd.map((d) => d.code))]}), quick fix offered`);

  // 2. Template opened as plaintext (no Astro extension): still activates, diagnoses, offers the preview
  const tpl = vscode.Uri.file(path.join(ws, "src/Card.astro"));
  const doc = await vscode.workspace.openTextDocument(tpl);
  await vscode.window.showTextDocument(doc);
  const td = await until("template diagnostics", () => mine(tpl).length && mine(tpl));
  assert.ok(td.some((d) => d.code === "HZ13") && td.some((d) => d.code === "HZ12"), `HZ12 + HZ13 in the template: ${td.map((d) => d.code)}`);
  const tActs = await vscode.commands.executeCommand("vscode.executeCodeActionProvider", tpl, td[0].range);
  const titles = tActs.map((a) => a.title);
  assert.ok(titles.some((t) => /preview fix/.test(t)) && titles.some((t) => /fix this file/.test(t)), `template actions: ${titles}`);
  step(`template (${doc.languageId}): ${td.length} diagnostics, actions: ${titles.join(" | ")}`);

  // 3. Preview: a diff editor of original ↔ fixed, file untouched
  const original = doc.getText();
  const fx = await vscode.commands.executeCommand("harakah.previewFix", tpl);
  assert.ok(fx && fx.edits > 0 && fx.after < fx.before, `preview summary ${JSON.stringify(fx)}`);
  const diff = await until("diff editor", () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputTextDiff && t.input.modified.scheme === "harakah-fixed"));
  const right = await vscode.workspace.openTextDocument(diff.input.modified);
  assert.match(right.getText(), /<bdi>iPhone 17<\/bdi> بسعر ٩٩٩/, "fixed side shows the text-level patch");
  assert.equal(doc.getText(), original, "preview doesn't touch the file");
  step(`preview: diff "${diff.label}", ${fx.edits} edits, findings ${fx.before} → ${fx.after}`);

  // 4. Apply: one undoable edit, the preview closes, saving clears the findings
  assert.ok(await vscode.commands.executeCommand("harakah.applyFix", tpl), "apply ok");
  assert.match(doc.getText(), /<h2>عرض خاص على <bdi>iPhone 17<\/bdi> بسعر ٩٩٩ دولار<\/h2>/);
  assert.ok(doc.isDirty, "applied as an editor edit (unsaved), not written behind the editor");
  await until("preview closed", () => !vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t) => t.input instanceof vscode.TabInputTextDiff && t.input.modified.scheme === "harakah-fixed"), 10000);
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand("undo");
  assert.equal(doc.getText(), original, "Ctrl+Z restores the original");
  await vscode.commands.executeCommand("redo");
  assert.notEqual(doc.getText(), original, "redo re-applies");
  await doc.save();
  await until("findings cleared after save", () => { const d = mine(tpl); return !d.some((x) => x.code === "HZ12" || x.code === "HZ13"); }, 60000);
  step("apply: undo/redo work; after save HZ12/HZ13 are gone");

  // 5. Remotion .tsx: the codemod (component + new vendored helper) in the refactor preview, nothing written until Apply
  const tsx = vscode.Uri.file(path.join(ws, "src/Title.tsx"));
  const helper = vscode.Uri.file(path.join(ws, "src/harakah-arabic.tsx"));
  const tdoc = await vscode.workspace.openTextDocument(tsx);
  await vscode.window.showTextDocument(tdoc);
  const xd = await until("tsx diagnostics", () => mine(tsx).length && mine(tsx));
  assert.ok(xd.some((d) => d.code === "HZ02"), `HZ02 on the per-letter split: ${xd.map((d) => d.code)}`);
  const xActs = (await vscode.commands.executeCommand("vscode.executeCodeActionProvider", tsx, xd[0].range)).map((a) => a.title);
  assert.ok(xActs.some((t) => /preview fix/.test(t)), `tsx actions: ${xActs}`);
  const tOriginal = tdoc.getText();
  const px = await vscode.commands.executeCommand("harakah.previewFix", tsx);
  const names = px.changes.map((c) => path.basename(c.file));
  assert.deepEqual(names, ["Title.tsx", "harakah-arabic.tsx"], "component + vendored helper");
  const tab = await until("multi-file diff", () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.label.startsWith("Harakah fix: ")));
  assert.equal(tdoc.getText(), tOriginal, "preview doesn't change the component");
  assert.ok(!(await vscode.workspace.fs.stat(helper).then(() => true, () => false)), "helper not created by the preview");
  assert.ok(await vscode.commands.executeCommand("harakah.applyFix", tsx), "apply ok");
  assert.match(tdoc.getText(), /harakah-arabic/, "component imports the vendored helper");
  const hdoc = await vscode.workspace.openTextDocument(helper);
  assert.match(hdoc.getText(), /^\/\/ Vendored by harakah-fix/, "helper created");
  assert.ok(tdoc.isDirty && hdoc.isDirty, "applied as editor edits (unsaved)");
  assert.ok((await hdoc.save()) && (await tdoc.save()), "saved");
  await until("tsx findings drop after save", () => mine(tsx).length < xd.length, 60000);
  step(`tsx: multi-file diff "${tab.label}", applied; findings ${xd.length} → ${mine(tsx).length}`);
};
