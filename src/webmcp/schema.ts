/**
 * A deliberately small JSON Schema subset: validation plus *coercion*.
 *
 * Real models are sloppy at the edges. They send `"3"` for an integer, `"true"`
 * for a boolean, a bare string where an array of one string is declared, and
 * `"Thursday"` where an enum wants `"thursday"`. Rejecting those is technically
 * correct and practically useless -- the agent burns a turn, apologises, and
 * tries again.
 *
 * So every Rota tool runs its arguments through here first. We coerce what is
 * unambiguously coercible, report what is not, and hand the tool clean typed
 * input. The coercions applied are reported back so they show up in the
 * provenance ledger rather than happening invisibly.
 */

export interface JsonSchema {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  additionalProperties?: boolean;
}

export interface CoerceResult<T = Record<string, unknown>> {
  ok: boolean;
  value: T;
  errors: string[];
  /** Human-readable notes like `copies: coerced "3" to 3`. */
  coercions: string[];
}

export function coerceArgs<T = Record<string, unknown>>(
  schema: JsonSchema | undefined,
  input: unknown,
): CoerceResult<T> {
  const errors: string[] = [];
  const coercions: string[] = [];
  if (!schema || schema.type !== "object" || !schema.properties) {
    return { ok: true, value: (input ?? {}) as T, errors, coercions };
  }

  const raw: Record<string, unknown> =
    input && typeof input === "object" && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : {};

  // Models occasionally nest everything under a wrapper key. Unwrap the common
  // cases rather than failing the call.
  for (const wrapper of ["input", "args", "arguments", "params", "parameters"]) {
    const inner = raw[wrapper];
    if (
      Object.keys(raw).length === 1 &&
      inner &&
      typeof inner === "object" &&
      !Array.isArray(inner)
    ) {
      coercions.push(`unwrapped arguments from "${wrapper}"`);
      return coerceArgs(schema, inner);
    }
  }

  const out: Record<string, unknown> = {};
  for (const [key, sub] of Object.entries(schema.properties)) {
    if (!(key in raw) || raw[key] === undefined || raw[key] === null || raw[key] === "") {
      if (sub.default !== undefined) out[key] = sub.default;
      continue;
    }
    const r = coerceValue(sub, raw[key], key);
    if (r.error) errors.push(r.error);
    else {
      out[key] = r.value;
      if (r.note) coercions.push(r.note);
    }
  }

  const unknownKeys = Object.keys(raw).filter((k) => !(k in schema.properties!));
  if (unknownKeys.length) coercions.push(`ignored unknown field(s): ${unknownKeys.join(", ")}`);

  for (const key of schema.required ?? []) {
    if (out[key] === undefined) errors.push(`missing required field "${key}"`);
  }

  return { ok: errors.length === 0, value: out as T, errors, coercions };
}

function coerceValue(
  schema: JsonSchema,
  value: unknown,
  path: string,
): { value?: unknown; error?: string; note?: string } {
  if (schema.enum) {
    if (schema.enum.includes(value)) return { value };
    if (typeof value === "string") {
      const norm = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
      const hit = schema.enum.find(
        (e) => typeof e === "string" && e.toLowerCase().replace(/[\s-]+/g, "_") === norm,
      );
      if (hit !== undefined) {
        return hit === value
          ? { value: hit }
          : { value: hit, note: `${path}: matched "${value}" to "${String(hit)}"` };
      }
    }
    return {
      error: `"${path}" must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}, got ${JSON.stringify(value)}`,
    };
  }

  switch (schema.type) {
    case "string": {
      if (typeof value === "string") return { value };
      if (typeof value === "number" || typeof value === "boolean") {
        return { value: String(value), note: `${path}: coerced ${JSON.stringify(value)} to string` };
      }
      return { error: `"${path}" must be a string` };
    }
    case "number":
    case "integer": {
      let n: number | null = null;
      if (typeof value === "number") n = value;
      else if (typeof value === "string") {
        const cleaned = value.replace(/[^0-9.eE+-]/g, "");
        const parsed = Number(cleaned);
        if (cleaned !== "" && Number.isFinite(parsed)) n = parsed;
      } else if (typeof value === "boolean") n = value ? 1 : 0;
      if (n === null) return { error: `"${path}" must be a number, got ${JSON.stringify(value)}` };
      if (schema.type === "integer" && !Number.isInteger(n)) {
        const rounded = Math.round(n);
        return { value: rounded, note: `${path}: rounded ${n} to ${rounded}` };
      }
      if (schema.minimum !== undefined && n < schema.minimum) {
        return { error: `"${path}" must be at least ${schema.minimum}` };
      }
      if (schema.maximum !== undefined && n > schema.maximum) {
        return { error: `"${path}" must be at most ${schema.maximum}` };
      }
      return typeof value === "number"
        ? { value: n }
        : { value: n, note: `${path}: coerced ${JSON.stringify(value)} to ${n}` };
    }
    case "boolean": {
      if (typeof value === "boolean") return { value };
      if (typeof value === "string") {
        const s = value.trim().toLowerCase();
        if (["true", "yes", "y", "1", "on"].includes(s)) {
          return { value: true, note: `${path}: coerced "${value}" to true` };
        }
        if (["false", "no", "n", "0", "off"].includes(s)) {
          return { value: false, note: `${path}: coerced "${value}" to false` };
        }
      }
      if (typeof value === "number") {
        return { value: value !== 0, note: `${path}: coerced ${value} to ${value !== 0}` };
      }
      return { error: `"${path}" must be a boolean` };
    }
    case "array": {
      let arr: unknown[];
      let note: string | undefined;
      if (Array.isArray(value)) arr = value;
      else if (typeof value === "string" && value.includes(",")) {
        arr = value.split(",").map((s) => s.trim()).filter(Boolean);
        note = `${path}: split "${value}" into ${arr.length} items`;
      } else {
        arr = [value];
        note = `${path}: wrapped a single value into an array`;
      }
      const items: unknown[] = [];
      for (let i = 0; i < arr.length; i++) {
        const r = coerceValue(schema.items ?? {}, arr[i], `${path}[${i}]`);
        if (r.error) return { error: r.error };
        items.push(r.value);
      }
      if (schema.minItems !== undefined && items.length < schema.minItems) {
        return { error: `"${path}" needs at least ${schema.minItems} item(s)` };
      }
      return { value: items, note };
    }
    case "object": {
      if (typeof value === "object" && value !== null && !Array.isArray(value)) return { value };
      if (typeof value === "string") {
        try {
          return { value: JSON.parse(value), note: `${path}: parsed JSON string` };
        } catch {
          /* fall through */
        }
      }
      return { error: `"${path}" must be an object` };
    }
    default:
      return { value };
  }
}

/** Spec rule: 1-128 chars of ASCII alphanumerics, `_`, `-` or `.`. */
export function isValidToolName(name: unknown): name is string {
  return typeof name === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(name);
}
