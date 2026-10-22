/**
 * A pass is a sync, pure IR→IR transform. Must not mutate `input`;
 * returning the same reference is allowed for identity passes.
 */
export interface Pass<IR> {
  readonly name: string
  run(input: IR): IR
}

/**
 * Runs passes in order, returning one entry per pass with the IR
 * after that pass ran. There is no implicit input entry — callers
 * that want to surface the raw input wrap it in an identity pass.
 */
export function runPasses<IR>(input: IR, passes: readonly Pass<IR>[]): { name: string; ir: IR }[] {
  const out: { name: string; ir: IR }[] = []
  let cur = input
  for (const p of passes) {
    cur = p.run(cur)
    out.push({ name: p.name, ir: cur })
  }
  return out
}
