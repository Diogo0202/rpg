"use client";

import { useEffect, useRef, useState } from "react";

type TacticalMapProps = {
  fogEnabled: boolean;
};

/**
 * The beta renderer uses a document-shaped scene and never evaluates user
 * supplied script. The persisted `maps.document` value will later feed it.
 */
export function TacticalMap({ fogEnabled }: TacticalMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState("Mara: C7");

  useEffect(() => {
    let disposed = false;
    let cleanup: () => void = () => {};

    async function mount() {
      const { Application, Graphics, Text } = await import("pixi.js");
      const app = new Application();
      await app.init({ background: "#d7cfae", width: 860, height: 470, antialias: true });
      if (disposed || !host.current) {
        app.destroy(true);
        return;
      }

      host.current.replaceChildren(app.canvas);
      const grid = new Graphics();
      for (let x = 0; x <= 860; x += 35) grid.moveTo(x, 0).lineTo(x, 470);
      for (let y = 0; y <= 470; y += 35) grid.moveTo(0, y).lineTo(860, y);
      grid.stroke({ width: 1, color: 0xaaa17f, alpha: 0.9 });
      app.stage.addChild(grid);

      const rooms = new Graphics();
      rooms.rect(100, 185, 300, 155).fill({ color: 0xac6f42, alpha: 0.36 }).stroke({ width: 4, color: 0x4d3227 });
      rooms.rect(570, 105, 210, 220).fill({ color: 0xac6f42, alpha: 0.36 }).stroke({ width: 4, color: 0x4d3227 });
      rooms.moveTo(400, 260).lineTo(570, 260).stroke({ width: 22, color: 0x705b42 });
      app.stage.addChild(rooms);

      const label = new Text({ text: "Distrito da Névoa", style: { fill: "#1a2c29", fontFamily: "Georgia", fontSize: 22, fontWeight: "bold" } });
      label.position.set(22, 18);
      app.stage.addChild(label);

      const token = new Graphics().circle(310, 260, 17).fill(0xaf4d35).stroke({ width: 3, color: 0xffffff });
      token.eventMode = "static";
      token.cursor = "grab";
      let dragging = false;
      token.on("pointerdown", () => { dragging = true; token.cursor = "grabbing"; });
      app.stage.eventMode = "static";
      app.stage.on("pointermove", (event) => {
        if (!dragging) return;
        token.position.set(event.global.x - 310, event.global.y - 260);
        setPosition(`Mara: ${Math.round(event.global.x / 35) + 1}${String.fromCharCode(65 + Math.round(event.global.y / 35))}`);
      });
      app.stage.on("pointerup", () => { dragging = false; token.cursor = "grab"; });
      app.stage.addChild(token);
      app.stage.addChild(new Graphics().circle(590, 190, 17).fill(0x476f5d).stroke({ width: 3, color: 0xffffff }));

      if (fogEnabled) app.stage.addChild(new Graphics().rect(0, 0, 860, 470).fill({ color: 0x122421, alpha: 0.62 }));
      cleanup = () => app.destroy(true);
    }

    void mount();
    return () => { disposed = true; cleanup(); };
  }, [fogEnabled]);

  return <div className="pixi-map" ref={host} aria-label={`Mapa tático. ${position}. Arraste o token vermelho.`} />;
}
