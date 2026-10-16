/** Parses model text as JSON, tolerating a ```json fence around it. */
export function parseJsonLoose(text: string): { ok: true; value: unknown } | { ok: false } {
  let candidate = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(candidate);
  if (fenced !== null) candidate = (fenced[1] as string).trim();
  try {
    return { ok: true, value: JSON.parse(candidate) as unknown };
  } catch {
    return { ok: false };
  }
}
