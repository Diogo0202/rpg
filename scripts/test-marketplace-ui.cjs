/* Browser checks for the public marketplace. All network traffic is local fixtures. */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const frontend = path.join(root, "frontend");
const localRequire = createRequire(path.join(frontend, "package.json"));
const webpack = localRequire("next/dist/compiled/webpack/webpack").webpack;
const { chromium } = require(process.env.RPG_PLAYWRIGHT_MODULE || "playwright");

const cards = [
  { id: "a1111111-1111-4111-8111-111111111111", name: "Ficha da Aurora", description: "Modelo público da comunidade.", tags: ["fantasia", "mesa-teste"], author_name: "Mestre Exemplo", automation_level: "static", dependencies: [], updated_at: "2026-10-23T10:00:00Z", usage_count: 7, likes: 5, dislikes: 1 },
  { id: "b2222222-2222-4222-8222-222222222222", name: "Ficha do Crepúsculo", description: "Outro modelo público.", tags: ["horror"], author_name: "Jogadora Exemplo", automation_level: "formulas", dependencies: ["Regra local"], updated_at: "2026-10-22T10:00:00Z", usage_count: 2, likes: 1, dislikes: 0 },
];
const campaignId = "c3333333-3333-4333-8333-333333333333";
const reportId = "e5555555-5555-4555-8555-555555555555";

async function checkPublicLoader() {
  const ts = localRequire("typescript");
  const sourcePath = path.join(frontend, "lib/marketplace-public.ts");
  const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", compiled)(module.exports, require, module, sourcePath, path.dirname(sourcePath));
  let requestOptions;
  const result = await module.exports.getPublicMarketplaceItems("https://api.fixture/", async (url, options) => {
    assert.equal(url, "https://api.fixture/api/v1/marketplace/systems");
    requestOptions = options;
    return new Response(JSON.stringify({ items: cards }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(result.error, null);
  assert.equal(result.items.length, 2);
  assert.equal(requestOptions.cache, "no-store");
  assert.equal(requestOptions.credentials, "omit");
  assert.deepEqual(requestOptions.headers, { Accept: "application/json" });
  assert.equal("Authorization" in requestOptions.headers, false);
}

async function main() {
  await checkPublicLoader();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-marketplace-ui-"));
  const source = path.join(scratch, "entry.tsx");
  const output = path.join(scratch, "bundle");
  fs.mkdirSync(output);
  fs.copyFileSync(path.join(frontend, "app/globals.css"), path.join(output, "globals.css"));
  fs.writeFileSync(path.join(scratch, "client.cjs"), "exports.createClient=()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture-only-token'}}})}});");
  fs.writeFileSync(path.join(scratch, "tsx-loader.cjs"), `const ts=require(${JSON.stringify(localRequire.resolve("typescript"))});module.exports=function(s){return ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;};`);
  fs.writeFileSync(path.join(scratch, "css-loader.cjs"), `const fs=require('node:fs');const path=require('node:path');module.exports=function(s){const prefix=path.basename(this.resourcePath).replace(/[^a-z]/g,'');const names={};const css=s.replace(/\\.([a-zA-Z_][\\w-]*)/g,(_,n)=>{names[n]=prefix+'_'+n;return '.'+names[n];});fs.writeFileSync(path.join(${JSON.stringify(output)},prefix+'.css'),css);return 'export default '+JSON.stringify(names);};`);
  fs.writeFileSync(source, `import React from 'react';import{createRoot}from'react-dom/client';import{MarketplacePanel}from${JSON.stringify(path.join(frontend, "components/marketplace-panel.tsx").replaceAll("\\", "/"))};createRoot(document.getElementById('root')).render(<MarketplacePanel initialItems={window.fixtureItems} initialError={null}/>);`);
  const compiler = webpack({ mode: "development", devtool: false, entry: source,
    output: { path: output, filename: "app.js" },
    resolve: { extensions: [".tsx", ".ts", ".js", ".cjs"], modules: [path.join(frontend, "node_modules"), "node_modules"] },
    module: { rules: [{ test: /\.tsx?$/, use: path.join(scratch, "tsx-loader.cjs") }, { test: /\.module\.css$/, use: path.join(scratch, "css-loader.cjs") }] },
    plugins: [new webpack.DefinePlugin({ "process.env.NEXT_PUBLIC_API_URL": JSON.stringify("http://fixture.local") }), new webpack.NormalModuleReplacementPlugin(/[/\\]supabase[/\\]client$/, path.join(scratch, "client.cjs"))],
  });
  await new Promise((resolve, reject) => compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true }))); else resolve(); }));
  const css = fs.readdirSync(output).filter((name) => name.endsWith(".css")).map((name) => `<link rel="stylesheet" href="/${name}">`).join("");
  const server = http.createServer((req, res) => {
    const basename = path.basename(new URL(req.url, "http://localhost").pathname);
    if (basename.endsWith(".js") || basename.endsWith(".css")) { res.setHeader("Content-Type", basename.endsWith(".js") ? "application/javascript" : "text/css"); res.end(fs.readFileSync(path.join(output, basename))); }
    else { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>window.fixtureItems=${JSON.stringify(cards)}</script>${css}<div id="root"></div><script src="/app.js"></script>`); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const screenshots = [];
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 980 } });
      const calls = { filters: [], reports: [], clones: [], publications: [], moderationReads: 0, resolutions: [] };
      let failedFilter = false; let failedReport = true; let failedClone = true; let failedModerationRead = true;
      await context.route("**/*", async (route) => {
        const req = route.request(); const url = new URL(req.url());
        if (url.origin === base) return route.continue();
        if (url.origin !== "http://fixture.local") return route.abort();
        if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,OPTIONS" } });
        const pathName = url.pathname; const body = req.postData() ? req.postDataJSON() : null;
        let value = null; let status = 200;
        if (pathName === "/api/v1/sync/campaigns" && req.method() === "GET") value = { protocol_version: 1, campaigns: [{ id: campaignId, name: "Mesa da Aurora" }] };
        else if (pathName === "/api/v1/marketplace/systems" && req.method() === "GET") {
          if (url.search) {
            calls.filters.push({ query: url.searchParams.get("q"), tags: url.searchParams.getAll("tags") });
            if (failedFilter) { status = 503; value = { detail: "Falha simulada na busca." }; }
            else value = { items: cards };
          } else value = { items: cards };
        } else if (pathName === "/api/v1/marketplace/systems" && req.method() === "POST") { calls.publications.push(body); value = cards[0]; }
        else if (pathName === `/api/v1/marketplace/systems/${cards[0].id}` && req.method() === "GET") value = { ...cards[0], template: { name: cards[0].name, version: 1, fields: [{ id: "nome", kind: "text" }] } };
        else if (pathName.endsWith("/report")) {
          calls.reports.push(body);
          if (failedReport) { failedReport = false; status = 503; value = { detail: "Falha simulada na denúncia." }; }
          else value = { ok: true };
        } else if (pathName.endsWith("/clone")) {
          calls.clones.push(body);
          if (failedClone) { failedClone = false; status = 503; value = { detail: "Falha simulada ao copiar." }; }
          else value = { id: "d4444444-4444-4444-8444-444444444444", campaign_id: body.campaign_id, name: cards[0].name };
        } else if (pathName === "/api/v1/marketplace/moderation/reports" && req.method() === "GET") {
          calls.moderationReads++;
          if (failedModerationRead) { failedModerationRead = false; status = 403; value = { detail: "operação não permitida" }; }
          else value = { items: [{ id: reportId, system_id: cards[0].id, reporter_id: "f6666666-6666-4666-8666-666666666666", reason: "Informação incorreta no modelo.", status: "open", created_at: "2026-10-23T12:00:00Z", system_name: cards[0].name, author_name: cards[0].author_name }], page: 1, limit: 20 };
        } else if (pathName === `/api/v1/marketplace/moderation/reports/${reportId}/resolve` && req.method() === "POST") { calls.resolutions.push(body); value = { ok: true }; }
        else if (pathName.endsWith("/vote")) value = { ok: true };
        else { status = 500; value = { detail: `Fixture sem rota para ${req.method()} ${pathName}` }; }
        await route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,OPTIONS" }, body: JSON.stringify(value) });
      });

      const page = await context.newPage();
      page.on("pageerror", (error) => { errors.push(error.message); console.error("fixture browser error:", error.message); });
      await page.goto(base);
      await page.getByRole("heading", { name: "Modelos de ficha" }).waitFor();
      await page.getByRole("heading", { name: cards[0].name }).waitFor();
      await page.waitForFunction(() => { const button = [...document.querySelectorAll("button")].find((element) => element.textContent === "Gostei"); return Boolean(button && !button.disabled); });
      assert.equal(await page.locator("article").count(), 2);
      assert.equal(calls.moderationReads, 0);

      const search = page.getByLabel("Buscar modelos", { exact: true });
      const tagSearch = page.getByLabel("Filtrar por tags", { exact: true });
      await search.fill("espada"); await tagSearch.fill("fantasia, horror");
      failedFilter = true;
      await page.getByRole("button", { name: "Buscar", exact: true }).click();
      await page.getByText("Falha simulada na busca.", { exact: false }).waitFor();
      assert.equal(await search.inputValue(), "espada");
      assert.equal(await tagSearch.inputValue(), "fantasia, horror");
      assert.equal(await page.locator("article").count(), 2);
      assert.deepEqual(calls.filters.at(-1), { query: "espada", tags: ["fantasia", "horror"] });
      failedFilter = false;

      await page.getByRole("button", { name: "Publicar modelo", exact: true }).click();
      await page.getByLabel("Nome público do autor").fill("Mestre da Aurora");
      await page.getByLabel("Descrição", { exact: true }).fill("Modelo criado para a comunidade.");
      await page.getByLabel("Tags, separadas por vírgulas").fill("fantasia");
      await page.getByLabel("JSON do modelo").fill(JSON.stringify({ name: "Novo modelo", version: 1, fields: [{ id: "nome", label: "Nome", kind: "text" }] }, null, 2));
      await page.getByRole("button", { name: "Enviar modelo", exact: true }).click();
      await page.getByText("Confirme que você tem direito de publicar este conteúdo.", { exact: true }).waitFor();
      assert.equal(calls.publications.length, 0);
      assert.equal(await page.getByLabel("Nome público do autor").inputValue(), "Mestre da Aurora");
      await page.getByLabel("Confirmo que tenho os direitos necessários para publicar este conteúdo.").check();
      await page.getByRole("button", { name: "Enviar modelo", exact: true }).click();
      const published = await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes("Modelo enviado para publicação."), null, { timeout: 10000 }).then(() => true).catch(() => false);
      if (!published) throw new Error(`publication status: ${await page.locator("body").innerText()} | calls: ${JSON.stringify(calls)}`);
      assert.equal(calls.publications.length, 1);
      assert.equal(calls.publications[0].rights_confirmed, true);

      const card = page.locator("article").filter({ hasText: cards[0].name }).first();
      await card.locator("summary").click();
      await card.getByLabel("Motivo").fill("Este modelo apresenta informação incorreta.");
      await card.getByRole("button", { name: "Enviar denúncia" }).click();
      await page.getByText("Falha simulada na denúncia.", { exact: false }).waitFor();
      assert.equal(await page.locator("article").filter({ hasText: cards[0].name }).count(), 1);
      await card.getByRole("button", { name: "Enviar denúncia" }).click();
      await page.getByText("Denúncia registrada. O modelo foi ocultado nesta tela.", { exact: true }).waitFor();
      assert.equal(await page.locator("article").filter({ hasText: cards[0].name }).count(), 0);
      assert.equal(calls.reports.length, 2);

      const second = page.locator("article").filter({ hasText: cards[1].name });
      await second.getByLabel("Campanha permitida").selectOption(campaignId);
      await second.getByRole("button", { name: "Copiar para campanha" }).click();
      await page.getByText("Falha simulada ao copiar.", { exact: false }).waitFor();
      const keyAfterFailure = calls.clones[0].idempotency_key;
      assert.equal(calls.clones[0].campaign_id, campaignId);
      assert.ok(keyAfterFailure.length >= 8);
      await second.getByRole("button", { name: "Copiar para campanha" }).click();
      await page.getByText("Modelo copiado para a campanha.", { exact: true }).waitFor();
      assert.equal(calls.clones[1].campaign_id, campaignId);
      assert.equal(calls.clones[1].idempotency_key, keyAfterFailure);

      await page.getByText("Moderação de denúncias", { exact: true }).click();
      await page.getByRole("button", { name: "Carregar denúncias", exact: true }).click();
      await page.getByText("Sua conta não tem permissão para acessar a fila de moderação.", { exact: true }).waitFor();
      assert.equal(await page.getByText(cards[0].name, { exact: true }).count(), 0);
      await page.getByRole("button", { name: "Carregar denúncias", exact: true }).click();
      await page.getByText("Informação incorreta no modelo.", { exact: true }).waitFor();
      await page.getByLabel("Nota de resolução").fill("Revisado pela equipe.");
      await page.getByRole("button", { name: "Remover modelo", exact: true }).click();
      await page.getByText("Denúncia resolvida e modelo removido.", { exact: true }).waitFor();
      assert.deepEqual(calls.resolutions, [{ action: "remove", note: "Revisado pela equipe." }]);

      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const screenshot = path.join(scratch, `marketplace-${width}.png`); await page.screenshot({ path: screenshot, fullPage: true }); screenshots.push(screenshot);
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: "passed", viewports: [1440, 390], checks: ["public no-store loader without auth or cookies", "initial public cards", "repeated tag filters retained after failure", "publication requires rights confirmation", "report hides card only after success", "clone retry reuses idempotency key and campaign UUID", "moderation loads only on request and explains 403", "authorized moderation action sends note", "no horizontal overflow", "no browser errors"], screenshots, environment: "Component browser harness; local fake API and Supabase session; outbound network blocked" }, null, 2));
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
