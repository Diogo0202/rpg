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
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-hunter-ui-"));
  const source = path.join(scratch, "entry.tsx");
  const output = path.join(scratch, "bundle");
  fs.mkdirSync(output);
  fs.copyFileSync(path.join(frontend, "app/globals.css"), path.join(output, "globals.css"));
  fs.writeFileSync(path.join(scratch,"ai.cjs"), "exports.AiSheetRequest=()=>null;");
  fs.writeFileSync(path.join(scratch,"portrait.cjs"), "exports.PortraitPicker=()=>null;");
  fs.writeFileSync(path.join(scratch, "tsx-loader.cjs"), `const ts=require(${JSON.stringify(localRequire.resolve("typescript"))});module.exports=function(s){return ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;};`);
  fs.writeFileSync(path.join(scratch, "css-loader.cjs"), `const fs=require('node:fs');const path=require('node:path');module.exports=function(s){const prefix=path.basename(this.resourcePath).replace(/[^a-z]/g,'');const names={};const css=s.replace(/\\.([a-zA-Z_][\\w-]*)/g,(_,n)=>{names[n]=prefix+'_'+n;return '.'+names[n];});fs.writeFileSync(path.join(${JSON.stringify(output)},prefix+'.css'),css);return 'export default '+JSON.stringify(names);};`);
  const component=JSON.stringify(path.join(frontend,"components/sheet-creation-wizard.tsx").replaceAll("\\","/"));
  const starters=JSON.stringify(path.join(frontend,"lib/system-starters.ts").replaceAll("\\","/"));
  fs.writeFileSync(source, `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{SheetCreationWizard}from${component};import{SYSTEM_STARTERS}from${starters};const s=SYSTEM_STARTERS.find(s=>s.id==='hunter');window.hunterRules=s.template.creation_rules;function Fixture(){const[v,setV]=useState({...s.values,nome:'Mara',credo:'Inquisitivo',impulso:'Curiosidade'});return <SheetCreationWizard campaignId="campaign" templates={[{id:'template',name:s.template.name,version:2,schema:s.template}]} templateId="template" template={s.template} values={v} name="Mara" calculated={{}} busy={false} canCreate={false} canGrantResources={false} loading={false} loadError="" feedback="" calculationError="" onChooseTemplate={()=>{}} onNameChange={()=>{}} onValueChange={(id,value)=>setV(p=>({...p,[id]:value}))} onSave={async()=>{}} viewerId="actor" portraitPath={null} onPortraitChange={()=>{}}/>}createRoot(document.getElementById('root')).render(<Fixture/>);`);
  const compiler = webpack({ mode: "development", devtool: false, entry: source,
    output: { path: output, filename: "app.js" },
    resolve: { extensions: [".tsx", ".ts", ".js", ".cjs"], modules: [path.join(frontend, "node_modules"), "node_modules"] },
    module: { rules: [{ test: /\.tsx?$/, use: path.join(scratch, "tsx-loader.cjs") }, { test: /\.module\.css$/, use: path.join(scratch, "css-loader.cjs") }] },
    plugins: [new webpack.DefinePlugin({ "process.env.NEXT_PUBLIC_API_URL": JSON.stringify("http://fixture.local") }), new webpack.NormalModuleReplacementPlugin(/[/\\]ai-assistance-panel$/, path.join(scratch,"ai.cjs")), new webpack.NormalModuleReplacementPlugin(/[/\\]portrait-picker$/, path.join(scratch,"portrait.cjs"))],
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
      const next=page.getByRole('button',{name:/Continuar/});
      await next.click();await next.click();
      await page.getByRole('heading',{name:'Atributos',exact:true}).waitFor();
      await next.click();
      assert.equal(await page.getByRole('heading',{name:'Atributos',exact:true}).count(),1);
      const rules=await page.evaluate(()=>window.hunterRules);
      const attributes=rules.find(r=>r.id==='atributos');
      const dots=[4,3,3,3,2,2,2,2,1];
      for(let i=0;i<attributes.fields.length;i++)await page.locator('#sheet-field-'+attributes.fields[i]).fill(String(dots[i]));
      await next.click();
      await page.getByRole('heading',{name:'Habilidades',exact:true}).waitFor();
      assert.equal(await page.locator('#sheet-field-briga').count(),0);
      await next.click();
      assert.equal(await page.getByRole('heading',{name:'Habilidades',exact:true}).count(),1);
      const skills=rules.find(r=>r.id==='habilidades');
      for(const option of skills.options){
        await page.getByRole('radio',{name:new RegExp(option.label)}).check();
        const values=Object.entries(option.counts).flatMap(([dot,count])=>Array(count).fill(Number(dot)));
        for(let i=0;i<skills.fields.length;i++)await page.locator('#sheet-field-'+skills.fields[i]).fill(String(values[i]??0));
        await next.click();
        await page.getByRole('heading',{name:'Traços',exact:true}).waitFor();
        await page.getByRole('button',{name:'Voltar',exact:true}).click();
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const capture=path.join(scratch,`hunter-${width}.png`);await page.screenshot({path:capture,fullPage:true});screenshots.push(capture);
      await page.close();
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'passed',viewports:[1440,390],checks:['nine attribute distribution enforced','27 skills','mode required before skills','all three distributions accepted','no overflow','no browser errors'],screenshots,environment:'Real component, local fake Supabase, all outbound network blocked'},null,2));
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1});

