import { ImageResponse } from "next/og";

export const alt = "RPG-Atlas, campanhas privadas de RPG";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, color: "#f3f0e5", background: "#17251f" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ width: 54, height: 54, display: "flex", alignItems: "center", justifyContent: "center", color: "#17251f", background: "#c3d4be", borderRadius: 16, fontSize: 34, fontWeight: 800 }}>A</div>
        <span style={{ color: "#c3d4be", fontSize: 26, letterSpacing: 4 }}>RPG-ATLAS</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ color: "#d5a963", fontSize: 22, letterSpacing: 5 }}>CAMPANHAS PRIVADAS</div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 950, fontSize: 68, lineHeight: 1.08, fontWeight: 700 }}><span>Sua campanha,</span><span>conectada.</span></div>
        <div style={{ color: "#c8d0c8", fontSize: 26 }}>Fichas, mundo e diário para sua mesa de RPG.</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#a7b7ab", fontSize: 18 }}>
        <div style={{ width: 48, height: 2, background: "#d5a963" }} /> Organize a próxima sessão
      </div>
    </div>,
    size,
  );
}
