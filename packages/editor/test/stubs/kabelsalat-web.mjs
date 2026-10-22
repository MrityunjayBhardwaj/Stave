// Stub for @kabelsalat/web in test environments only.
// Strudel's repl.mjs imports SalatRepl but we never invoke a REPL during tests.
// See packages/editor/src/codeView/ir/__tests__/parity.test.ts header for context.
export class SalatRepl {
  constructor() {}
}
