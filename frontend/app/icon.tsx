import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1c2b28", color: "#ddcf82", fontSize: 360, fontFamily: "Georgia", border: "24px solid #ddcf82" }}>
      R
    </div>,
    size,
  );
}
