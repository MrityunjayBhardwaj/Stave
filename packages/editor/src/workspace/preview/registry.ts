/**
 * Preview provider registry — Phase 10.2 Task 06.
 *
 * Module-level Map keyed by file extension. Mirrors the runtime provider
 * registry in `workspace/runtime/registry.ts` line-for-line — same
 * extension-normalization rules, same language parallel map, same test-only
 * reset helper. The duplication is deliberate: the two registries serve
 * different concerns (runtime = executable languages, preview = visual
 * output) and keeping them in lockstep at the API level makes callers (Task
 * 09's compat shims, Task 10's app rewire) symmetric across the two.
 *
 * @remarks
 * ## Extension keying convention
 *
 * Keys include the leading dot (`.hydra`, `.p5`). Mirrors how Node and
 * most editors talk about file extensions. The lookup helpers normalize
 * on input — callers can pass either `.hydra` or `hydra` and get the
 * same provider back.
 *
 * Each provider may claim multiple extensions (its `extensions` array).
 * `registerPreviewProvider` registers under every claimed extension. If
 * another provider had previously registered any of those extensions, the
 * later call wins for those keys.
 *
 * ## Why also key by language
 *
 * Tab dispatch knows the file's language (`WorkspaceFile.language`), not
 * its extension. The two are 1:1 in 10.2 (hydra↔hydra, p5↔p5js) but the
 * indirection lets future languages with multiple extensions avoid
 * extension-leak through the preview-resolution path. The registry keeps
 * a parallel `Map<language, provider>` so language-keyed lookups stay
 * O(1).
 *
 * Languages recognized by the 10.2 built-in providers:
 *   - `'hydra'` → HYDRA_VIZ
 *   - `'p5js'` → P5_VIZ
 *
 * ## MARKDOWN_HTML is NOT registered here
 *
 * Per CONTEXT U7, the markdown provider is deferred to Phase 10.3. The
 * slot for `.md` in the registry is intentionally open — when no provider
 * matches a preview request, `PreviewView`'s caller (Task 09/10) shows the
 * "No preview provider registered" fallback. Don't add a markdown stub
 * here "just in case"; the gap IS the spec.
 *
 * ## Test isolation
 *
 * `resetPreviewRegistryForTests()` clears the maps. Matches the runtime
 * registry's `resetRuntimeRegistryForTests`. Tests call this in
 * `beforeEach` to avoid cross-test leakage when one test registers a
 * provider another test doesn't expect.
 */

import type { PreviewProvider } from '../PreviewProvider'

const byExtension = new Map<string, PreviewProvider>()
const byLanguage = new Map<string, PreviewProvider>()

/**
 * Normalize an extension input to the canonical leading-dot form. `'foo'`
 * → `'.foo'`; `'.foo'` → `'.foo'`. Empty / undefined inputs return
 * `undefined` (callers handle the lookup-miss path).
 */
function normalizeExtension(ext: string | undefined): string | undefined {
  if (!ext) return undefined
  return ext.startsWith('.') ? ext : `.${ext}`
}

/**
 * Map a provider extension to the workspace language id it previews.
 * Mirrors the `.p5` → `'p5js'` quirk in `WorkspaceLanguage` (the preset
 * renderer is `p5`, the Monaco language is `p5js`). Unknown extensions
 * return `undefined` — providers with non-standard extensions (future
 * `.glsl`, `.wav`, etc.) will need their own mapping here.
 */
function extensionToLanguage(ext: string): string | undefined {
  switch (ext) {
    case '.hydra':
      return 'hydra'
    case '.p5':
      return 'p5js'
    case '.glsl':
      return 'glsl'
    case '.three':
      return 'three'
    case '.md':
      return 'markdown'
    default:
      return undefined
  }
}

/**
 * Register a preview provider under every extension it claims AND every
 * mapped language id. Calling for the same extension twice replaces the
 * previous provider for THAT extension only — other extensions are
 * unaffected. Same "registration is idempotent on key" semantics as the
 * runtime registry.
 */
export function registerPreviewProvider(provider: PreviewProvider): void {
  for (const rawExt of provider.extensions) {
    const ext = normalizeExtension(rawExt)
    if (!ext) continue
    byExtension.set(ext, provider)
    const lang = extensionToLanguage(ext)
    if (lang) byLanguage.set(lang, provider)
  }
}

/**
 * Look up a provider by file extension. Accepts either dotted (`.hydra`)
 * or undotted (`hydra`) form. Returns `undefined` if no provider is
 * registered for the extension.
 */
export function getPreviewProviderForExtension(
  extension: string,
): PreviewProvider | undefined {
  const key = normalizeExtension(extension)
  if (!key) return undefined
  return byExtension.get(key)
}

/**
 * Look up a provider by workspace language id (e.g., `'hydra'`, `'p5js'`).
 * The shell's per-tab preview resolution uses this — the tab carries a
 * language string (via `WorkspaceFile.language`), not an extension.
 * Returns `undefined` if no provider is registered for the language.
 */
export function getPreviewProviderForLanguage(
  language: string,
): PreviewProvider | undefined {
  return byLanguage.get(language)
}

/**
 * The full registry as a read-only Map keyed by extension. Used by Task 09
 * (compat shims) and Task 10 (app rewire) when enumerating providers at
 * startup. The map is intentionally immutable from the caller's
 * perspective: mutation goes through `registerPreviewProvider` so both
 * maps stay in sync.
 */
export const previewProviderRegistry: ReadonlyMap<string, PreviewProvider> =
  byExtension

/**
 * TESTING ONLY — reset every internal map. Used by unit tests to ensure
 * isolation between cases. Mirrors `resetRuntimeRegistryForTests`. Not
 * exported via the package barrel; tests import directly.
 */
export function resetPreviewRegistryForTests(): void {
  byExtension.clear()
  byLanguage.clear()
}
