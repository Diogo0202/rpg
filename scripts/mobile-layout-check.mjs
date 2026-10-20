import { createServer } from "node:http";

// Local layout fixture, never served by the application or shipped in its public assets.
// Open /?size=mobile or /?size=desktop while the mobile dev server runs on 4173.
const server = createServer((request, response) => {
  const desktop = new URL(request.url, "http://127.0.0.1:4175").searchParams.get("size") === "desktop";
  const [width, height] = desktop ? [1440, 1000] : [390, 844];
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Layout RPG-Atlas ${width}x${height}</title><style>body{margin:0;background:#ddd;font:14px system-ui}header{padding:8px}iframe{display:block;border:0;width:${width}px;height:${height}px;background:#fff}</style><header>Viewport de teste: ${width} × ${height}. Dados locais desta origem.</header><iframe title="RPG-Atlas Mobile ${width} por ${height}" src="http://127.0.0.1:4173/"></iframe></html>`);
});
server.listen(4175, "127.0.0.1", () => console.log("Layout fixture: http://127.0.0.1:4175/?size=mobile"));
