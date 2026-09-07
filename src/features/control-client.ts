export type Mutate = (path: string, body: unknown, success: string, method?: "POST" | "DELETE") => Promise<void>;

export async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? fallback);
  return body;
}
