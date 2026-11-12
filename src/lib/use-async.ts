import { useCallback, useEffect, useState } from "react";

/** Lädt Daten asynchron; `reload()` lädt neu. Fehler landen in `error`. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(async () => {
    try {
      setData(await run());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [run]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, setData, error, reload };
}

/** Führt eine Mutation aus und lädt danach neu; Fehler werden gemeldet statt verschluckt. */
export async function mutate(fn: () => Promise<unknown>, reload: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    window.alert(String(e));
  }
  await reload();
}
