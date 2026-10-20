import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { pgtap } from "@electric-sql/pglite-pgtap";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Local Postgres WASM only: no network, Supabase project or credentials. */
export async function createTestDatabase({ through } = {}) {
  const db = new PGlite({ extensions: { vector, pgtap } });
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, aud text, role text, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', current_user)
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner_id uuid);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
    create extension pgtap;
  `);
  const files = (await readdir(path.join(root, "supabase/migrations")))
    .filter((name) => name.endsWith(".sql") && (!through || name <= through)).sort();
  for (const file of files) {
    try {
      await db.exec((await readFile(path.join(root, "supabase/migrations", file), "utf8")).replace(/^\uFEFF/, ""));
    } catch (error) {
      await db.close();
      throw new Error(`Migration ${file}: ${error.message}`, { cause: error });
    }
  }
  return { db, migrations: files };
}

export async function runDatabaseTests({ through, testName, excludeTest } = {}) {
  const { db, migrations } = await createTestDatabase({ through });
  let assertions = 0;
  const failures = [];
  const files = (await readdir(path.join(root, "supabase/tests")))
    .filter((name) => name.endsWith(".test.sql") && (!testName || name.includes(testName)) && (!excludeTest || !name.includes(excludeTest))).sort();
  try {
    for (const file of files) {
      try {
        const results = await db.exec((await readFile(path.join(root, "supabase/tests", file), "utf8")).replace(/^\uFEFF/, ""));
        const lines = results.flatMap((result) => result.rows.flatMap((row) => Object.values(row)))
          .filter((value) => typeof value === "string").flatMap((value) => value.split("\n"));
        const tests = lines.filter((line) => /^(?:not )?ok \d+/.test(line));
        assertions += tests.length;
        const bad = lines.filter((line) => /^not ok|^# (?:Looks like|Failed test)/.test(line));
        if (!tests.length || bad.length) failures.push({ file, lines: bad.length ? lines.filter((line) => /^not ok|^#/.test(line)) : ["No TAP assertions emitted"] });
        console.log(`${bad.length ? "FAIL" : "PASS"} ${file}: ${tests.length} assertions`);
      } catch (error) {
        await db.exec("rollback; reset role;");
        failures.push({ file, lines: [error.message] });
        console.log(`FAIL ${file}: ${error.message}`);
      }
    }
  } finally {
    await db.close();
  }
  console.log(JSON.stringify({ environment: "PGlite local Postgres WASM; Auth/Storage fixture", migrations: migrations.length, files: files.length, assertions, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
  return { migrations, assertions, failures };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = (name) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? undefined : process.argv[index + 1];
  };
  await runDatabaseTests({ through: argument("--through"), testName: argument("--test"), excludeTest: argument("--exclude") });
}
