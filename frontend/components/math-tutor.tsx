"use client";

import { useRef, useState, type FormEvent } from "react";
import styles from "./ai-assistance-panel.module.css";

type Answer = { expression: string; result: number; explanation: string | null };
type Input = { expression: string; values: Record<string, number>; explain: boolean; idempotency_key?: string };

export function MathTutor({ enabled, send }: { enabled: boolean; send: (body: Input) => Promise<Answer> }) {
  const [expression, setExpression] = useState("forca + vigor * 2");
  const [variables, setVariables] = useState('{"forca": 3, "vigor": 2}');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const version = useRef(0);
  function change(update: () => void) { version.current += 1; update(); setAnswer(null); setMessage(""); }
  async function calculate(explain: boolean) {
    if (busy) return;
    const current = version.current;
    setBusy(true); setMessage("");
    try {
      const values: unknown = JSON.parse(variables);
      if (!values || typeof values !== "object" || Array.isArray(values) || Object.values(values).some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("Informe um objeto JSON com valores numéricos.");
      const body: Input = { expression, values: values as Record<string, number>, explain };
      if (explain) {
        const signature = JSON.stringify(body);
        if (operation.current?.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
        body.idempotency_key = operation.current.id;
      }
      const result = await send(body);
      if (current === version.current) setAnswer(result);
    } catch (error) { if (current === version.current) setMessage(error instanceof Error ? error.message : "Não foi possível calcular."); }
    finally { setBusy(false); }
  }
  return <section className={styles.card} aria-label="Tutor matemático">
    <h3>Tutor matemático</h3>
    <p>O servidor calcula a expressão. A IA explica a conta, sem criar regras ou reproduzir livros. Nenhuma ficha é alterada.</p>
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); void calculate(false); }}>
      <label>Expressão<input aria-label="Expressão matemática" required maxLength={120} value={expression} onChange={(event) => change(() => setExpression(event.target.value))} /></label>
      <label>Variáveis numéricas (JSON)<textarea aria-label="Variáveis numéricas" rows={3} maxLength={4000} value={variables} onChange={(event) => change(() => setVariables(event.target.value))} /></label>
      <button disabled={busy || !expression.trim()}>{busy ? "Calculando…" : "Calcular sem IA"}</button>
    </form>
    {answer && <output aria-live="polite"><p>Resultado: <strong>{answer.result}</strong></p>{answer.explanation && <p>{answer.explanation}</p>}</output>}
    {!enabled && <p>A explicação por IA está desativada. O cálculo continua disponível online.</p>}
    <button className={styles.secondary} disabled={busy || !enabled || !answer} onClick={() => void calculate(true)}>Explicar com IA (consome o orçamento da campanha)</button>
    {message && <p role="alert">{message}</p>}
  </section>;
}
