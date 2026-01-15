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

  return { data, loading, error, refetch };
}
