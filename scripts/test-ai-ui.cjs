/* Component browser checks. All API traffic is fulfilled locally, never paid. */
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

async function main() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-ai-ui-"));
  const source = path.join(scratch, "entry.tsx");
  const output = path.join(scratch, "bundle");
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(scratch, "client.cjs"), "exports.createClient=()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture-only-token'}}})}});");
  fs.writeFileSync(path.join(scratch, "tsx-loader.cjs"), `const ts=require(${JSON.stringify(localRequire.resolve("typescript"))});module.exports=function(s){return ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;};`);
  fs.writeFileSync(path.join(scratch, "css-loader.cjs"), `const fs=require('node:fs');const path=require('node:path');module.exports=function(s){const prefix=path.basename(this.resourcePath).replace(/[^a-z]/g,'');const names={};const css=s.replace(/\\.([a-zA-Z_][\\w-]*)/g,(_,n)=>{names[n]=prefix+'_'+n;return '.'+names[n];});fs.writeFileSync(path.join(${JSON.stringify(output)},prefix+'.css'),css);return 'export default '+JSON.stringify(names);};`);
  fs.writeFileSync(source, `import React from 'react';import{createRoot}from'react-dom/client';import{AiAssistancePanel,AiSheetRequest}from${JSON.stringify(path.join(frontend, "components/ai-assistance-panel.tsx").replaceAll("\\", "/"))};const mode=new URLSearchParams(location.search).get('mode');createRoot(document.getElementById('root')).render(mode==='sheet'?<AiSheetRequest campaignId="campaign" templateId="template"/>:<AiAssistancePanel campaignId="campaign" viewerId="master" canManage={true}/>);`);
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
    else { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}<div id="root"></div><script src="/app.js"></script>`); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const screenshots = [];
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 960 } });
      let enabled = true; let failNext = false; let approvals = 0; let publications = []; let generations = []; let refinements = [];
      let requests = [{ id: "proposal", kind: "npc", status: "pending", version: 1, brief: "Desenvolver a informante" }];
      let preparations = [];
      const npc = { name: "Informante", description: "Dona do café", motivation: "Preservar o bairro", voice: "Frases curtas", secret: "SEGREDO PRIVADO", hook: "Um bilhete", relationships: [], questions: [] };
      const sourceItem = { kind: "entity", id: "npc", title: "Informante", entity_kind: "npc" };
      await context.route("**/*", async (route) => {
        const req = route.request(); const url = new URL(req.url());
        if (url.origin === base) return route.continue();
        if (url.origin !== "http://fixture.local") return route.abort();
        const suffix = url.pathname.split("/ai/")[1]; const body = req.postData() ? req.postDataJSON() : null;
        let value = null; let status = 200;
        if (suffix === "config") value = { enabled, model: "fixture", budget_monthly_usd: 30 };
        else if (suffix === "context") value = { items: [sourceItem] };
        else if (suffix === "context/preview") value = { context: { items: [{ ...sourceItem, content: { description: "CONTEXTO SELECIONADO" } }] }, context_hash: "a".repeat(64) };
        else if (suffix === "preparations") value = preparations;
        else if (suffix === "proposals" && req.method() === "GET") value = requests;
        else if (suffix === "proposals" && req.method() === "POST") {
          generations.push(body);
          if (failNext) { failNext = false; status = 503; value = { detail: "Falha simulada; tente novamente." }; }
          else { const item = { id: `request-${generations.length}`, kind: body.kind, status: "pending", version: 1, brief: body.brief }; requests.push(item); value = { request: item }; }
        } else if (suffix === "proposals/proposal") value = { request: requests[0], result: npc, original: null, template: null };
        else if (suffix === "proposals/proposal/refine") { refinements.push(body); Object.assign(npc, body.result); requests[0].version += 1; value = { request: requests[0] }; }
        else if (suffix === "proposals/proposal/approve") { approvals++; requests[0].status = "approved"; preparations = [{ id: "prep", kind: "npc", title: "Informante", body: body.result, version: 1 }]; value = { request: requests[0], destination_id: "prep" }; }
        else if (suffix === "preparations/prep/publish") { publications.push(body); value = { destination_id: "public-npc" }; }
        else { status = 500; value = { detail: `Unexpected fixture request ${suffix}` }; }
        await route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(value) });
      });
      const page = await context.newPage(); page.on("pageerror", (error) => { errors.push(error.message); console.error("fixture browser error:", error.message); });
      await page.goto(base);
      await page.getByText("Ativo · fixture", { exact: false }).waitFor({ timeout: 10000 }).catch(async (error) => { console.error("fixture body:", await page.locator("body").innerText()); throw error; });
      await page.getByLabel("Tipo", { exact: true }).selectOption("npc");
      await page.getByLabel("O que deseja desenvolver?").fill("Criar motivação para a informante");
      await page.getByLabel("Destino", { exact: true }).selectOption("npc");
      assert.equal(await page.getByRole("button", { name: "Gerar proposta privada" }).isDisabled(), true);
      await page.getByRole("button", { name: "Conferir contexto que será enviado" }).click();
      await page.getByText("Conteúdo exato dos registros selecionados").waitFor();
      await page.getByRole("button", { name: "Gerar proposta privada" }).click();
      await page.getByText("Proposta criada para revisão privada.", { exact: true }).waitFor();
      assert.equal(generations[0].context_hash, "a".repeat(64));
      await page.getByRole("button", { name: "Desenvolver a informante", exact: true }).click();
      await page.getByLabel("Segredo privado", { exact: true }).fill("SEGREDO REVISADO");
      await page.getByLabel("Como a proposta deve melhorar?", { exact: true }).fill("Mantenha meu segredo revisado e melhore a motivação");
      await page.getByRole("button", { name: "Gerar refinamento para revisão", exact: true }).click();
      await page.getByText("Refinamento pronto para revisão.", { exact: true }).waitFor();
      assert.equal(refinements[0].result.secret, "SEGREDO REVISADO");
      await page.getByRole("button", { name: "Desenvolver a informante", exact: true }).click();
      assert.equal(await page.getByLabel("Segredo privado", { exact: true }).inputValue(), "SEGREDO REVISADO");
      assert.equal(approvals, 0);
      await page.getByRole("button", { name: "Aprovar e aplicar", exact: true }).click();
      await page.getByText("Marque somente os campos que os jogadores poderão ler.", { exact: true }).waitFor();
      assert.equal(approvals, 1); assert.equal(publications.length, 0);
      await page.getByLabel("Publicar Nome", { exact: true }).check();
      await page.getByRole("button", { name: "Publicar campos selecionados", exact: true }).click();
      await page.getByText("Somente os campos selecionados foram publicados.", { exact: true }).waitFor();
      assert.deepEqual(publications[0].fields, { name: "Informante" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const screenshot = path.join(scratch, `narrador-${width}.png`); await page.screenshot({ path: screenshot, fullPage: true }); screenshots.push(screenshot);
      await page.goto(base + "?mode=sheet");
      await page.getByLabel("Conceito do personagem", { exact: true }).fill("Uma investigadora cautelosa");
      await page.getByLabel("Campos que deseja desenvolver", { exact: true }).fill("Contatos e motivação");
      await page.getByRole("button", { name: "Solicitar proposta", exact: true }).waitFor();
      failNext = true;
      await page.getByRole("button", { name: "Solicitar proposta", exact: true }).click();
      await page.getByText("Falha simulada; tente novamente.", { exact: true }).waitFor();
      assert.equal(await page.getByLabel("Conceito do personagem").inputValue(), "Uma investigadora cautelosa");
      const failedKey = generations.at(-1).idempotency_key;
      await page.getByRole("button", { name: "Solicitar proposta", exact: true }).click();
      await page.getByText("Pedido enviado. O narrador revisará a proposta antes de aplicar à sua ficha.", { exact: true }).waitFor();
      assert.equal(generations.at(-1).idempotency_key, failedKey);
      assert.equal(await page.getByRole("button", { name: "Aprovar e aplicar" }).count(), 0);
      enabled = false; await page.goto(base + "?mode=sheet");
      await page.getByText("A assistência está desativada. O preenchimento manual continua disponível.", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Solicitar proposta", exact: true }).isDisabled(), true);
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: "passed", viewports: [1440, 390], checks: ["context preview", "refinement preserves edits", "manager approval", "private content", "selected publication", "error preserves form", "idempotent retry", "disabled state", "no overflow", "no browser errors"], screenshots, environment: "Component harness; fake Supabase session and API; no provider calls" }, null, 2));
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
