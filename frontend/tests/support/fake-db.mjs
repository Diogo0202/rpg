/**
 * Cliente Supabase falso para os testes de `lib/data/`. Cada `from` ou `rpc`
 * abre uma cadeia; cada método chamado na cadeia é gravado com os argumentos.
 * A cadeia resolve com `result` quando é aguardada.
 */
export function fakeDb(result = { data: null, error: null }) {
  const calls = [];
  const chain = (steps) => new Proxy(function () {}, {
    get(_target, name) {
      if (name === "then") return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
      return (...args) => {
        steps.push([name, ...args]);
        return chain(steps);
      };
    },
  });
  const start = (kind) => (...args) => {
    const steps = [[kind, ...args]];
    calls.push(steps);
    return chain(steps);
  };
  return { db: { from: start("from"), rpc: start("rpc") }, calls };
}
