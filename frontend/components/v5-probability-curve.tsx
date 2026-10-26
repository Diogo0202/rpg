"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

type Roll = { success: number; messy_critical: number; bestial_failure: number };
type CurvePoint = { difficulty: number; without_reroll: Roll; with_reroll: Roll };
type CurveSeries = { pool: number; hunger_dice: number; points: CurvePoint[] };
type CurveResponse = { hunger: number; reroll_limit: number; series: CurveSeries[] };

const apiBase = process.env.NEXT_PUBLIC_API_URL;
const COLORS = ["#b84a31", "#425e4b", "#2f5f8a", "#a07a1f", "#6b3f7a", "#172020"];
const WIDTH = 560;
const HEIGHT = 300;
const PAD = { left: 44, right: 16, top: 16, bottom: 36 };

/** Lista de inteiros distintos e ordenados a partir de "3, 5, 7" ou "1-6". */
export function parseIntegerList(text: string, min: number, max: number, limit: number): number[] | null {
  const values = new Set<number>();
  for (const part of text.split(",").map((item) => item.trim()).filter(Boolean)) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    const [start, end] = range ? [Number(range[1]), Number(range[2])] : [Number(part), Number(part)];
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) return null;
    for (let value = start; value <= end; value += 1) {
      if (value < min || value > max) return null;
      values.add(value);
      if (values.size > limit) return null;
    }
  }
  return values.size ? [...values].sort((a, b) => a - b) : null;
}

export function V5ProbabilityCurve({ hunger, rerolls }: { hunger: number; rerolls: number }) {
  const [poolsText, setPoolsText] = useState("3, 5, 7, 9");
  const [difficultiesText, setDifficultiesText] = useState("1-8");
  const [useWillpower, setUseWillpower] = useState(true);
  const [curve, setCurve] = useState<CurveResponse | null>(null);
  const [message, setMessage] = useState("");

  const pools = useMemo(() => parseIntegerList(poolsText, 0, 30, 6), [poolsText]);
  const difficulties = useMemo(() => parseIntegerList(difficultiesText, 1, 100, 8), [difficultiesText]);

  useEffect(() => {
    const controller = new AbortController();
    const validHunger = Number.isInteger(hunger) && hunger >= 0 && hunger <= 5;
    const validRerolls = Number.isInteger(rerolls) && rerolls >= 0 && rerolls <= 3;
    if (!pools || !difficulties || !validHunger || !validRerolls) {
      setCurve(null);
      setMessage("Use até 6 paradas (0 a 30) e até 8 dificuldades (1 a 100), separadas por vírgula ou intervalo.");
      return () => controller.abort();
    }
    const timer = window.setTimeout(async () => {
      try {
        if (!apiBase) throw new Error("Configure NEXT_PUBLIC_API_URL para acessar a API.");
        const { data } = await createClient().auth.getSession();
        if (!data.session) throw new Error("Entre na campanha para calcular a curva.");
        const response = await fetch(`${apiBase}/api/v1/v5/probability-curve`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
          body: JSON.stringify({ pools, difficulties, hunger, willpower_dice: rerolls }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Confira as paradas e dificuldades da curva.");
        const body = (await response.json()) as CurveResponse;
        if (!controller.signal.aborted) { setCurve(body); setMessage(""); }
      } catch (error) {
        if (controller.signal.aborted) return;
        setCurve(null);
        setMessage(error instanceof Error ? error.message : "Não foi possível calcular a curva.");
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [pools, difficulties, hunger, rerolls]);

  const xs = curve?.series[0]?.points.map((point) => point.difficulty) ?? [];
  const xMin = xs[0] ?? 1;
  const xMax = xs[xs.length - 1] ?? 1;
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (value: number) => PAD.left + (xMax === xMin ? plotW / 2 : ((value - xMin) / (xMax - xMin)) * plotW);
  const y = (chance: number) => PAD.top + (1 - chance) * plotH;
  const pick = (point: CurvePoint) => (useWillpower ? point.with_reroll : point.without_reroll).success;

  return <article className="generation-card" aria-labelledby="v5-curve-title">
    <p className="eyebrow">CURVA COMPARATIVA</p>
    <h3 id="v5-curve-title">Paradas contra dificuldades · Fome {hunger}</h3>
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
      <label>Paradas<input value={poolsText} onChange={(event) => setPoolsText(event.target.value)} aria-describedby="v5-curve-help" /></label>
      <label>Dificuldades<input value={difficultiesText} onChange={(event) => setDifficultiesText(event.target.value)} aria-describedby="v5-curve-help" /></label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={useWillpower} onChange={(event) => setUseWillpower(event.target.checked)} style={{ width: "auto", margin: 0 }} />
        Com Vontade (até {rerolls} dados)
      </label>
    </div>
    <p id="v5-curve-help" className="probability-note">Ex.: &quot;3, 5, 7&quot; ou &quot;1-6&quot;. A Fome é limitada ao tamanho de cada parada.</p>
    {message && <p className="auth-message" role="status">{message}</p>}
    {curve && <>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Chance de atingir a dificuldade por parada" style={{ width: "100%", height: "auto", display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => <g key={tick}>
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} stroke="#c9c4b5" strokeDasharray={tick % 1 ? "3 4" : undefined} />
          <text x={PAD.left - 6} y={y(tick) + 4} fontSize="11" textAnchor="end" fill="#6f746d">{tick * 100}%</text>
        </g>)}
        {xs.map((difficulty) => <text key={difficulty} x={x(difficulty)} y={HEIGHT - PAD.bottom + 16} fontSize="11" textAnchor="middle" fill="#6f746d">{difficulty}</text>)}
        <text x={PAD.left + plotW / 2} y={HEIGHT - 4} fontSize="11" textAnchor="middle" fill="#6f746d">Dificuldade</text>
        {curve.series.map((series, index) => {
          const color = COLORS[index % COLORS.length];
          return <g key={series.pool}>
            <polyline fill="none" stroke={color} strokeWidth="2.5" points={series.points.map((point) => `${x(point.difficulty)},${y(pick(point))}`).join(" ")} />
            {series.points.map((point) => <circle key={point.difficulty} cx={x(point.difficulty)} cy={y(pick(point))} r="3.5" fill={color}>
              <title>{`Parada ${series.pool}, dificuldade ${point.difficulty}: ${(pick(point) * 100).toFixed(1)}%`}</title>
            </circle>)}
          </g>;
        })}
      </svg>
      <ul style={{ display: "flex", flexWrap: "wrap", gap: 14, listStyle: "none", padding: 0, margin: "8px 0" }}>
        {curve.series.map((series, index) => <li key={series.pool} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <i aria-hidden style={{ width: 14, height: 3, background: COLORS[index % COLORS.length], display: "inline-block" }} />
          Parada {series.pool} ({series.hunger_dice} de Fome)
        </li>)}
      </ul>
      <details>
        <summary className="probability-note">Tabela da curva</summary>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
            <thead><tr><th scope="col" style={{ textAlign: "left" }}>Parada</th>{xs.map((difficulty) => <th key={difficulty} scope="col">Dif. {difficulty}</th>)}</tr></thead>
            <tbody>{curve.series.map((series) => <tr key={series.pool}>
              <th scope="row" style={{ textAlign: "left" }}>{series.pool}</th>
              {series.points.map((point) => <td key={point.difficulty} style={{ textAlign: "center", padding: "3px 4px" }}>
                {(point.without_reroll.success * 100).toFixed(0)}% / {(point.with_reroll.success * 100).toFixed(0)}%
              </td>)}
            </tr>)}</tbody>
          </table>
          <p className="probability-note">Cada célula: sem rerrolagem / com Vontade.</p>
        </div>
      </details>
    </>}
  </article>;
}
