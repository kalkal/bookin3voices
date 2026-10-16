// Gemini's responseSchema uses the OpenAPI dialect (type names in upper case,
// `propertyOrdering`). Bedrock tool input schemas are standard JSON Schema.

const DROPPED_KEYS = new Set(['propertyOrdering', 'nullable']);

export function toJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (typeof schema !== 'object' || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (DROPPED_KEYS.has(key)) continue;
    if (key === 'type' && typeof value === 'string') out[key] = value.toLowerCase();
    else out[key] = toJsonSchema(value);
  }
  return out;
}
