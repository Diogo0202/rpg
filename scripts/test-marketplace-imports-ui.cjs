/* Browser checks against local fixtures only, without Supabase credentials. */
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
const campaignId = "c3333333-3333-4333-8333-333333333333";
const otherCampaign = "c4444444-4444-4444-8444-444444444444";
const item = {
  id: "d4444444-4444-4444-8444-444444444444", name: "Modelo revisável", version: 1,
  source_name: "Acervo de teste", source_status: "published",
  schema: { name: "Modelo revisável", version: 1, fields: [
    { id: "nome", label: '<img src=x onerror="window.injected=true">', kind: "text", required: true, options: [], expression: null },
    { id: "parada", label: "Parada", kind: "formula", required: false, options: [], expression: "vigor + 2" },
  ], creation_rules: [], system_key: "homebrew" },
};

async function main() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-marketplace-imports-ui-"));
  const output = path.join(scratch, "bundle");
  fs.mkdirSync(output);
  const source = path.join(scratch, "entry.tsx");
  fs.writeFileSync(path.join(scratch, "client.cjs"), "module.exports.createClient=()=>({rpc:(name,args)=>window.reviewRpc(name,args)});");
  fs.writeFileSync(path.join(scratch, "tsx-loader.cjs"), `const ts=require(${JSON.stringify(localRequire.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;`);
  fs.writeFileSync(path.join(scratch, "css-loader.cjs"), `const fs=require('node:fs');module.exports=s=>{const names={};const css=s.replace(/\\.([a-zA-Z_][\\w-]*)/g,(_,n)=>{names[n]='review_'+n;return '.'+names[n];});fs.writeFileSync(${JSON.stringify(path.join(output, "review.css"))},css);return 'export default '+JSON.stringify(names);};`);
  fs.writeFileSync(source, `import React from 'react';import{createRoot}from'react-dom/client';import{MarketplaceImportsPanel}from${JSON.stringify(path.join(frontend, "components/marketplace-imports-panel.tsx").replaceAll("\\", "/"))};const root=createRoot(document.getElementById('root'));window.showReview=(props={})=>root.render(<MarketplaceImportsPanel campaignId={${JSON.stringify(campaignId)}} viewerId="fixture-user" canManage={window.fixtureCanManage} onOpenSheets={()=>window.openedSheets++} {...props}/>);window.showReview();`);
  const compiler = webpack({ mode: "development", devtool: false, entry: source,
    output: { path: output, filename: "app.js" },
    resolve: { extensions: [".tsx", ".ts", ".js", ".cjs"], modules: [path.join(frontend, "node_modules"), "node_modules"] },
    module: { rules: [{ test: /\.tsx?$/, use: path.join(scratch, "tsx-loader.cjs") }, { test: /\.module\.css$/, use: path.join(scratch, "css-loader.cjs") }] },
    plugins: [new webpack.NormalModuleReplacementPlugin(/[/\\]supabase[/\\]client$/, path.join(scratch, "client.cjs"))],
  });
  await new Promise((resolve, reject) => compiler.run((error, stats) => {
    compiler.close(() => {});
    if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true }))); else resolve();
  }));
  const server = http.createServer((req, res) => {
    const name = path.basename(new URL(req.url, "http://localhost").pathname);
    if (name === "app.js" || name === "review.css") {
      res.setHeader("Content-Type", name.endsWith(".js") ? "application/javascript" : "text/css");
      res.end(fs.readFileSync(path.join(output, name))); return;
    }
    const player = name === "player";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/review.css"><style>:root{--line:#ccc;--panel:#fff;--ink:#222;--muted:#555;--accent:#70501c}*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui;background:#f5f1e8;color:#222}.content{padding:20px;max-width:1100px;margin:auto}button,a{font:inherit;min-height:44px}button{cursor:pointer}button:disabled{cursor:default}a{color:inherit}</style><div id="root"></div><script>
      window.fixtureCanManage=${JSON.stringify(!player)};window.items=${JSON.stringify([item])};window.calls=[];window.openedSheets=0;window.approveMode='ok';window.holdLoads=false;window.loads=[];window.holdApproval=false;
      window.reviewRpc=async(name,args)=>{window.calls.push({name,args});if(name==='marketplace_pending_imports'){if(window.holdLoads)return new Promise(resolve=>window.loads.push({campaign:args.p_campaign_id,resolve}));return{data:structuredClone(window.items),error:null};}
      if(window.holdApproval)return new Promise(resolve=>window.finishApproval=resolve);
      if(window.approveMode==='conflict')return{data:null,error:{code:'22023'}};
      if(window.approveMode==='denied')return{data:null,error:{code:'42501'}};
      return{data:args.p_template_id,error:null};};
      </script><script src="/app.js"></script></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const screenshots = [];
  let scenarios = 0;
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.route("**/*", (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base);
      await page.getByRole("button", { name: "Revisar Modelo revisável", exact: true }).click();
      const approve = page.getByRole("button", { name: "Aprovar para criar fichas", exact: true });
      assert.equal(await approve.isDisabled(), true);
      assert.equal(await page.locator("img").count(), 0);
      assert.equal(await page.evaluate(() => Boolean(window.injected)), false);
      await page.getByRole("checkbox").check();
      assert.equal(await approve.isEnabled(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const screenshot = path.join(scratch, `review-${width}.png`);
      await page.screenshot({ path: screenshot, fullPage: true }); screenshots.push(screenshot);
      await approve.evaluate((button) => { button.click(); button.click(); });
      await page.getByRole("status").filter({ hasText: "foi aprovado" }).waitFor();
      const approvals = await page.evaluate(() => window.calls.filter((call) => call.name === "marketplace_approve_import"));
      assert.equal(approvals.length, 1);
      assert.deepEqual(approvals[0].args, { p_campaign_id: campaignId, p_template_id: item.id, p_expected_schema: item.schema });
      await page.getByRole("button", { name: "Ir para fichas", exact: true }).click();
      assert.equal(await page.evaluate(() => window.openedSheets), 1); scenarios++;

      await page.reload();
      await page.getByRole("button", { name: "Revisar Modelo revisável", exact: true }).click();
      await page.getByRole("checkbox").check();
      await page.evaluate(() => { window.approveMode = "conflict"; });
      await page.getByRole("button", { name: "Aprovar para criar fichas", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "mudou durante a revisão" }).waitFor();
      assert.equal(await page.getByRole("checkbox").count(), 0);
      await page.getByRole("button", { name: "Atualizar importações", exact: true }).click();
      await page.getByRole("button", { name: "Revisar Modelo revisável", exact: true }).waitFor(); scenarios++;

      await page.evaluate(() => { window.items[0].source_status = "hidden"; });
      await page.getByRole("button", { name: "Atualizar importações", exact: true }).click();
      await page.getByText("A publicação de origem está indisponível.", { exact: false }).waitFor();
      await page.getByRole("button", { name: "Revisar Modelo revisável", exact: true }).click();
      assert.equal(await page.getByRole("checkbox").isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "Aprovar para criar fichas", exact: true }).isDisabled(), true); scenarios++;

      await page.reload();
      await page.getByRole("button", { name: "Revisar Modelo revisável", exact: true }).click();
      await page.evaluate(() => { window.holdLoads = true; });
      await page.getByRole("button", { name: "Atualizar importações", exact: true }).click();
      await page.waitForFunction(() => window.loads.length === 1);
      await page.evaluate((campaign) => window.showReview({ campaignId: campaign }), otherCampaign);
      await page.waitForFunction(() => window.loads.length === 2);
      await page.evaluate(() => { window.loads[1].resolve({ data: [], error: null }); });
      await page.getByText("Nenhum modelo do Marketplace aguarda aprovação nesta campanha.", { exact: true }).waitFor();
      await page.evaluate(() => { window.loads[0].resolve({ data: window.items, error: null }); });
      await page.waitForTimeout(100);
      assert.equal(await page.getByRole("button", { name: "Revisar Modelo revisável", exact: true }).count(), 0); scenarios++;

      await page.reload();
      await page.getByRole("button", { name: "Revisar Modelo revisável", exact: true }).click();
      await page.getByRole("checkbox").check();
      await page.evaluate(() => { window.holdApproval = true; });
      await page.getByRole("button", { name: "Aprovar para criar fichas", exact: true }).click();
      await page.waitForFunction(() => typeof window.finishApproval === "function");
      await page.evaluate((campaign) => { window.items = []; window.showReview({ campaignId: campaign }); }, otherCampaign);
      await page.getByText("Nenhum modelo do Marketplace aguarda aprovação nesta campanha.", { exact: true }).waitFor();
      await page.evaluate(({ campaign, pending }) => { window.items = [pending]; window.showReview({ campaignId: campaign }); }, { campaign: campaignId, pending: item });
      await page.getByRole("button", { name: "Revisar Modelo revisável", exact: true }).waitFor();
      await page.evaluate((id) => window.finishApproval({ data: id, error: null }), item.id);
      await page.waitForTimeout(100);
      assert.equal(await page.getByText(/foi aprovado/).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Revisar Modelo revisável", exact: true }).count(), 1); scenarios++;

      await page.goto(`${base}/player`);
      await page.getByText("Somente o narrador pode revisar modelos importados para esta campanha.", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.calls.length), 0); scenarios++;
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ scenarios, widths: [1440, 390], screenshots, errors, network: "local fixtures only" }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
