#!/usr/bin/env node
// Cadastra, remove e lista administradores do marketplace (tabela public.marketplace_admins).
// Usa apenas APIs do Node. A chave de serviço nunca é impressa.

const usage = `Uso: node scripts/marketplace-admin.mjs <comando> [email]

Comandos:
  add <email>     torna o usuário administrador do marketplace
  remove <email>  remove o usuário da lista de administradores
  list            lista os administradores (id, e-mail, data)

Variáveis de ambiente obrigatórias:
  SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL)
  SUPABASE_SERVICE_ROLE_KEY`;

function fail(message, code = 1) {
  console.error(`Erro: ${message}`);
  process.exit(code);
}

const [command, emailArg] = process.argv.slice(2);
if (!["add", "remove", "list"].includes(command ?? "")) {
  console.error(usage);
  process.exit(command ? 1 : 0);
}
if (command !== "list" && !emailArg) fail(`o comando "${command}" exige um e-mail.\n\n${usage}`);

const baseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!baseUrl) fail("defina SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL).");
if (!key) fail("defina SUPABASE_SERVICE_ROLE_KEY.");
if (!/^https?:\/\//.test(baseUrl)) fail("SUPABASE_URL deve começar com http:// ou https://.");

const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function call(path, init = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  } catch (error) {
    fail(`não foi possível conectar a ${baseUrl}: ${error.cause?.code ?? error.message}`);
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 300);
    try { const body = JSON.parse(text); detail = body.message || body.msg || body.error_description || detail; } catch { /* texto simples */ }
    if (response.status === 401 || response.status === 403) detail = `acesso negado (verifique a chave de serviço). ${detail}`;
    fail(`${init.method ?? "GET"} ${path.split("?")[0]} respondeu ${response.status}: ${detail}`);
  }
  return text ? JSON.parse(text) : null;
}

async function findUserByEmail(email) {
  const wanted = email.trim().toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 500; page += 1) {
    const body = await call(`/auth/v1/admin/users?page=${page}&per_page=${perPage}`);
    const users = Array.isArray(body) ? body : body?.users ?? [];
    const match = users.find((user) => typeof user.email === "string" && user.email.toLowerCase() === wanted);
    if (match) return match;
    if (users.length < perPage) break;
  }
  return null;
}

if (command === "list") {
  const rows = await call("/rest/v1/marketplace_admins?select=user_id,created_at&order=created_at");
  if (!rows.length) { console.log("Nenhum administrador cadastrado."); process.exit(0); }
  for (const row of rows) {
    let email = "(e-mail não encontrado)";
    try {
      const user = await call(`/auth/v1/admin/users/${encodeURIComponent(row.user_id)}`);
      if (user?.email) email = user.email;
    } catch { /* fail() encerra; este ramo só protege contra respostas inesperadas */ }
    console.log(`${row.user_id}\t${email}\t${row.created_at}`);
  }
  process.exit(0);
}

const user = await findUserByEmail(emailArg);
if (!user) fail(`nenhum usuário com o e-mail ${emailArg}.`);

if (command === "add") {
  await call("/rest/v1/marketplace_admins?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: user.id }),
  });
  console.log(`${user.email} (${user.id}) é administrador do marketplace.`);
} else {
  await call(`/rest/v1/marketplace_admins?user_id=eq.${encodeURIComponent(user.id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  console.log(`${user.email} (${user.id}) não é mais administrador do marketplace.`);
}
