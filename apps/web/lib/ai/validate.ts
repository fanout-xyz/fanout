/**
 * A small schema checker for what the AI sends back. Its output is untrusted input: every field is
 * checked for type, range and length before anything uses it, and anything unexpected is refused.
 */

export class AiInvalid extends Error {
  override name = "AiInvalid";
}

export type Check<T> = (value: unknown, path: string) => T;

const fail = (path: string, what: string): never => {
  throw new AiInvalid(`${path || "response"} ${what}`);
};

export const check = {
  string:
    (opts: { max?: number; min?: number; pattern?: RegExp } = {}): Check<string> =>
    (value, path) => {
      if (typeof value !== "string") return fail(path, "is not text");
      if (opts.min !== undefined && value.length < opts.min) return fail(path, "is too short");
      if (value.length > (opts.max ?? 2000)) return fail(path, "is too long");
      if (opts.pattern && !opts.pattern.test(value)) return fail(path, "has an unexpected format");
      return value;
    },

  int:
    (opts: { min?: number; max?: number } = {}): Check<number> =>
    (value, path) => {
      if (typeof value !== "number" || !Number.isInteger(value)) return fail(path, "is not a whole number");
      if (opts.min !== undefined && value < opts.min) return fail(path, "is too small");
      if (opts.max !== undefined && value > opts.max) return fail(path, "is too large");
      return value;
    },

  boolean: (): Check<boolean> => (value, path) => (typeof value === "boolean" ? value : fail(path, "is not true or false")),

  oneOf:
    <const T extends string>(values: readonly T[]): Check<T> =>
    (value, path) =>
      typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : fail(path, "is not an allowed value"),

  /** null or missing -> null. */
  nullable:
    <T>(inner: Check<T>): Check<T | null> =>
    (value, path) =>
      value === null || value === undefined ? null : inner(value, path),

  array:
    <T>(item: Check<T>, opts: { max: number }): Check<T[]> =>
    (value, path) => {
      if (!Array.isArray(value)) return fail(path, "is not a list");
      if (value.length > opts.max) return fail(path, "has too many items");
      return value.map((v, i) => item(v, `${path}[${i}]`));
    },

  object:
    <S extends Record<string, Check<unknown>>>(shape: S): Check<{ [K in keyof S]: ReturnType<S[K]> }> =>
    (value, path) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(path, "is not an object");
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(shape)) {
        out[key] = inner((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
      }
      return out as { [K in keyof S]: ReturnType<S[K]> };
    },
};
