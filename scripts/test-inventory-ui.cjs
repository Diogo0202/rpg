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
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-inventory-ui-"));
  const source = path.join(scratch, "entry.tsx");
  const output = path.join(scratch, "bundle");
  fs.mkdirSync(output);
  fs.copyFileSync(path.join(frontend, "app/globals.css"), path.join(output, "globals.css"));
  fs.writeFileSync(path.join(scratch, "client.cjs"), "exports.createClient=()=>({from:(table)=>{let payload=null,method='read';const chain={select:()=>chain,eq:()=>chain,order:()=>chain,update:(body)=>{payload=body;method='update';return chain},insert:(body)=>{payload=body;method='insert';return chain},single:async()=>({data:table==='character_sheets'?{template_id:'template'}:{schema:{inventory_schema:[{id:'peso',label:'Peso',kind:'number',min:0,max:10},{id:'material',label:'Material',kind:'select',options:['Ferro','Madeira']}]}}}),then:(resolve)=>{window.inventoryRows??=[{id:'item',name:'Corda',category:'equipment',quantity:1,resource_cost:0,damage_bonus:0,protection:0,notes:'Original',acquired:true,equipped:false,sort_order:0,version:1,custom_values:{peso:2,material:'Ferro'}}];if(method!=='read'){window.inventoryWrites??=[];window.inventoryWrites.push(payload);Object.assign(window.inventoryRows[0],payload)}return Promise.resolve(resolve({data:method==='read'?window.inventoryRows:[{id:'item'}],error:null}))}};return chain}});");
  fs.writeFileSync(path.join(scratch, "tsx-loader.cjs"), `const ts=require(${JSON.stringify(localRequire.resolve("typescript"))});module.exports=function(s){return ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;};`);
  fs.writeFileSync(path.join(scratch, "css-loader.cjs"), `const fs=require('node:fs');const path=require('node:path');module.exports=function(s){const prefix=path.basename(this.resourcePath).replace(/[^a-z]/g,'');const names={};const css=s.replace(/\\.([a-zA-Z_][\\w-]*)/g,(_,n)=>{names[n]=prefix+'_'+n;return '.'+names[n];});fs.writeFileSync(path.join(${JSON.stringify(output)},prefix+'.css'),css);return 'export default '+JSON.stringify(names);};`);
  fs.writeFileSync(path.join(scratch,"session.cjs"), "exports.useCharacterSession=()=>({character:{id:'sheet',name:'Teste',values:{recursos:3}}});");
  fs.writeFileSync(source, `import React from 'react';import{createRoot}from'react-dom/client';import{CharacterInventoryPanel}from${JSON.stringify(path.join(frontend,"components/character-inventory-panel.tsx").replaceAll("\\","/"))};createRoot(document.getElementById('root')).render(<CharacterInventoryPanel campaignId="campaign" canEdit={true}/>);`);
  const compiler = webpack({ mode: "development", devtool: false, entry: source,
    output: { path: output, filename: "app.js" },
    resolve: { extensions: [".tsx", ".ts", ".js", ".cjs"], modules: [path.join(frontend, "node_modules"), "node_modules"] },
    module: { rules: [{ test: /\.tsx?$/, use: path.join(scratch, "tsx-loader.cjs") }, { test: /\.module\.css$/, use: path.join(scratch, "css-loader.cjs") }] },
    plugins: [new webpack.DefinePlugin({ "process.env.NEXT_PUBLIC_API_URL": JSON.stringify("http://fixture.local") }), new webpack.NormalModuleReplacementPlugin(/[/\\]supabase[/\\]client$/, path.join(scratch, "client.cjs")), new webpack.NormalModuleReplacementPlugin(/[/\\]character-session$/, path.join(scratch,"session.cjs"))],
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
  const browser = await chromium.launch({headless:true});
  const errors=[], screenshots=[];
  try {
    for(const width of [1440,390]) {
      const page=await browser.newPage({viewport:{width,height:960}});
      page.on('pageerror', error=>errors.push(error.message));
      await page.route('**/*', route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
      await page.goto(base);
      await page.getByLabel('Peso',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Editar Corda',exact:true}).click();
      assert.equal(await page.getByLabel('Peso',{exact:true}).inputValue(),'2');
      await page.getByLabel('Peso',{exact:true}).fill('3.5');
      await page.getByLabel('Material').selectOption('Madeira');
      await page.getByRole('button',{name:'Salvar item',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Item salvo.'}).waitFor();
      const writes=await page.evaluate(()=>window.inventoryWrites);
      assert.deepEqual(writes.at(-1).custom_values,{peso:3.5,material:'Madeira'});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const capture=path.join(scratch,`inventory-${width}.png`);await page.screenshot({path:capture,fullPage:true});screenshots.push(capture);
      await page.close();
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'passed',viewports:[1440,390],checks:['schema fields rendered','existing item values preserved','numeric and select fields saved','no overflow','no browser errors'],screenshots,environment:'Real component, local fake Supabase, all outbound network blocked'},null,2));
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1});

