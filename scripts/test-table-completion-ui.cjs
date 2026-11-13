/* Real React panels, local API fixtures. No hosted Auth, mail or database writes. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const front = path.join(root, 'frontend');
const req = createRequire(path.join(front, 'package.json'));
const webpack = req('next/dist/compiled/webpack/webpack').webpack;
let playwright;
try { playwright = require(process.env.RPG_PLAYWRIGHT_MODULE || 'playwright'); }
catch { playwright = require('C:/Users/digme/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'); }

async function main() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-table-completion-ui-'));
  const out = path.join(scratch, 'bundle');
  fs.mkdirSync(out);
  const source = (name) => JSON.stringify(path.join(front, name).replaceAll('\\', '/'));
  fs.writeFileSync(path.join(scratch, 'tsx.cjs'), `const ts=require(${JSON.stringify(req.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  fs.writeFileSync(path.join(scratch, 'css.cjs'), 'module.exports=()=>"export default {}";');
  fs.writeFileSync(path.join(scratch, 'client.cjs'), 'exports.createClient=()=>({auth:{getSession:async()=>({data:{session:{access_token:"fixture-token"}}})}});');
  fs.writeFileSync(path.join(scratch, 'entry.tsx'), `
    import React,{useEffect}from'react';import{createRoot}from'react-dom/client';
    import{CharacterSessionProvider,useCharacterSession}from${source('lib/character-session.tsx')};
    import{V3VampirePanel}from${source('components/v3-vampire-panel.tsx')};
    import{V5ProbabilityPanel}from${source('components/v5-probability-panel.tsx')};
    function Demo(){const session=useCharacterSession();useEffect(()=>{window.choose=session.selectCharacter;session.selectCharacter({id:'10000000-0000-4000-8000-000000000001',name:'Lia',version:1,values:{forca:3,fome:2,pontos_sangue:4,ant_geracao:0,forca_vontade:3},effects:[]});},[]);return location.search.includes('v3')?session.character&&<V3VampirePanel character={session.character} canManage={true}/>:<V5ProbabilityPanel/>;}
    createRoot(document.getElementById('root')).render(<CharacterSessionProvider><Demo/></CharacterSessionProvider>);`);
  const compiler = webpack({ mode: 'development', devtool: false, entry: path.join(scratch, 'entry.tsx'), output: { path: out, filename: 'app.js' },
    plugins: [new webpack.DefinePlugin({ 'process.env.NEXT_PUBLIC_API_URL': JSON.stringify('https://api.example.test') }),
      new webpack.NormalModuleReplacementPlugin(/[/\\]supabase[/\\]client$/, path.join(scratch, 'client.cjs'))],
    resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(front, 'node_modules'), 'node_modules'] },
    module: { rules: [{ test: /\.tsx?$/, use: path.join(scratch, 'tsx.cjs') }, { test: /\.module\.css$/, use: path.join(scratch, 'css.cjs') }] } });
  await new Promise((resolve, reject) => compiler.run((err, stats) => {
    compiler.close(() => {}); err || stats.hasErrors() ? reject(err || new Error(stats.toString({ all: false, errors: true }))) : resolve();
  }));
  const server = http.createServer((request, response) => {
    if (request.url === '/app.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(fs.readFileSync(path.join(out, 'app.js'))); }
    else { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/app.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await playwright.chromium.launch({ headless: true }).catch(async error => {
    await new Promise(resolve => server.close(resolve)); throw error;
  });
  const errors = [];
  const requests = [];
  let scenarios = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://api.example.test/**', async route => {
      const request = route.request(); const pathname = new URL(request.url()).pathname;
      const body = request.postDataJSON();
      requests.push({ pathname, method: request.method(), body });
      let result = [];
      if (pathname.endsWith('/state')) result = { state: 'active' };
      else if (pathname.endsWith('/actions')) result = { state: body.action === 'morte_final' ? 'final_death' : 'active', applied: 2, sheet: { values: { pontos_sangue: 6 }, version: 2 } };
      else if (pathname.endsWith('/probabilities')) result = {
        without_reroll: { success: 0.5, messy_critical: 0.02, bestial_failure: 0.1 }, with_reroll: { success: 0.7, messy_critical: 0.01, bestial_failure: 0.05 }, reroll_limit: 3, hunger_dice: 2,
        modifier_preview: { base_pool: 6, total_delta: 0, adjusted_pool: 6, applied: [], skipped: [], clipped: false },
      };
      else if (pathname.endsWith('/probability-curve')) result = { hunger: 2, reroll_limit: 3, series: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
    });
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url);
    await page.getByText('50.0%', { exact: true }).first().waitFor();
    assert.equal(await page.getByLabel('Fome', { exact: true }).isDisabled(), true);
    const prediction = requests.findLast(request => request.pathname.includes('/sheets/') && request.pathname.endsWith('/probabilities'));
    assert.deepEqual(Object.keys(prediction.body).sort(), ['context_tags', 'difficulty', 'pool', 'willpower_dice']); scenarios++;
    const manualResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/v5/probabilities' && response.request().method() === 'POST');
    await page.evaluate(() => window.choose(null));
    await page.getByText('Simulação sem personagem e sem condições.').waitFor();
    await manualResponse;
    assert.equal(await page.getByLabel('Fome', { exact: true }).isEnabled(), true);
    assert.ok(requests.findLast(request => request.pathname === '/api/v1/v5/probabilities').body.hunger >= 0); scenarios++;
    await page.goto(`${url}?v3`);
    await page.getByText('Estado: Ativo.', { exact: true }).waitFor();
    await page.getByLabel('Registro da decisão', { exact: true }).fill('Presa aprovada pelo narrador');
    await page.getByRole('button', { name: 'Registrar alimentação', exact: true }).click();
    await page.getByText(/Alimentação/).first().waitFor();
    await page.waitForFunction(() => document.body.innerText.includes('sangue 6'));
    const feeding = requests.findLast(request => request.body?.action === 'alimentar');
    assert.equal(feeding.body.note, 'Presa aprovada pelo narrador');
    assert.match(feeding.body.operation_id, /^[0-9a-f-]{36}$/); scenarios++;
    assert.equal(await page.getByRole('button', { name: 'Registrar Morte Final', exact: true }).isDisabled(), true);
    await page.getByLabel('Confirmo a Morte Final permanente').check();
    await page.getByRole('button', { name: 'Registrar Morte Final', exact: true }).click();
    await page.getByText('Estado: Morte Final.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Rolar', exact: true }).isDisabled(), true); scenarios++;
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ scenarios, pageErrors: errors, environment: 'Chromium local with real panels and simulated API; no hosted validation' }, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
