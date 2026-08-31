/**
 * True outside production builds.
 *
 * Written as a literal `process.env.NODE_ENV` comparison so bundlers replace it
 * and drop the guarded code, but guarded by `typeof` so the library still loads
 * where `process` does not exist. `process` is declared locally rather than
 * pulled in from Node's types, which a browser library has no business
 * depending on.
 */
declare const process: { env?: { NODE_ENV?: string } } | undefined;

export const DEV =
  typeof process === "undefined" || process.env?.NODE_ENV !== "production";
