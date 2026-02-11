import { useState, useEffect } from "react";

export function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(url);
        const json = (await response.json()) as T & { error?: string };

        if (!cancelled) {
          if (json.error) {
            setError(json.error);
          } else {
            setData(json);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [url]);

  const refetch = async () => {
    setLoading(true);
    try {
      const response = await fetch(url);
      const json = (await response.json()) as T & { error?: string };
      if (json.error) {
        setError(json.error);
      } else {
        setData(json);
        setError(null);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return { data, setData, loading, error, refetch };
}

interface MutationOptions<TData, TBody> {
  onSuccess?: (data: TData) => void;
  onError?: (error: string) => void;
}

export function useMutation<TData = any, TBody = any>(
  url: string,
  method: "POST" | "PUT" | "DELETE" = "POST",
  options?: MutationOptions<TData, TBody>
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = async (body?: TBody): Promise<TData | null> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const json = await response.json() as TData & { error?: string };
      if ((json as any).error) {
        const errMsg = (json as any).error;
        setError(errMsg);
        options?.onError?.(errMsg);
        return null;
      }
      options?.onSuccess?.(json);
      return json;
    } catch (err) {
      const errMsg = String(err);
      setError(errMsg);
      options?.onError?.(errMsg);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { mutate, loading, error };
}
