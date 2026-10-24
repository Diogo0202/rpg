import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Keep Lovable's target unchanged. Local builds use Vite's output for preview.
const root = fileURLToPath(new URL("../", import.meta.url));
const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const child = spawn(process.execPath, [vite, "build"], {
  cwd: root,
  env: { ...process.env, RPG_MOBILE_LOCAL_BUILD: "1" },
  stdio: "inherit",
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
