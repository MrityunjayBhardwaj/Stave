/**
 * Monaco language registration for workspace views — Phase 10.2 Task 03.
 *
 * `EditorView` mounts Monaco once per file, not once per workspace. Every
 * mount potentially touches a different language (`strudel`, `sonicpi`,
 * `hydra`, `p5js`). Rather than scatter registration calls across the four
 * legacy monoliths (`LiveCodingEditor`, `StrudelEditor`, `VizEditor`, and
 * the deleted `StrudelMonaco`), this module exposes one entry point — `ensureWorkspaceLanguages()`
 * — that every workspace editor calls on Monaco mount.
 *
 * @remarks
 * ## Idempotency
 *
 * `monaco.languages.register({ id })` is NOT idempotent — calling it twice
 * with the same id inside a single Monaco instance leaves the definition in
 * a degraded state (duplicate registration warnings, partial tokenizer
 * reset). Each individual register function in this module guards via a
 * module-level `registered` flag AND via `monaco.languages.getLanguages()`
 * lookup, so second-and-subsequent calls are safe no-ops.
 *
 * ## Why not import from `LiveCodingEditor.tsx` / `VizEditor.tsx`?
 *
 * Those files are destined for deletion in Task 09 (per the plan) and
 * currently live in the `visualizers/` directory — importing from them
 * would create a reverse dependency from the new workspace module into the
 * legacy monoliths, blocking their removal. Instead we:
 *
 *   - Reuse the already-extracted `registerStrudelLanguage` /
 *     `registerSonicPiLanguage` from `monaco/language.ts` (both helpers
 *     predate Task 09 and will survive it).
 *   - Define the hydra and p5js Monarch providers inline here, mirroring
 *     the existing `VizEditor.tsx:28-78` definitions verbatim. When
 *     `VizEditor.tsx` is deleted, these become the single source of truth.
 *
 * ## Pattern borrowed from Task 02
 *
 * `recency: string[]` and the identity guard in `WorkspaceAudioBus.ts`
 * established the discipline: module-level state is fine as long as it has
 * a `__reset*ForTests` escape hatch. This file follows the same discipline
 * so unit tests can register-reset-register without hitting the
 * already-registered guard.
 */

import type * as Monaco from 'monaco-editor'
import {
  registerStrudelLanguage,
  registerSonicPiLanguage,
} from '../monaco/language'
import {
  registerStrudelDotCompletions,
  registerStrudelNoteCompletions,
} from '../monaco/strudelCompletions'
import { registerStrudelHover } from '../monaco/strudelDocs'
import { ensureStrudelLintCodeActionProvider } from '../monaco/diagnostics'
import { registerStrudelFoldingProvider } from '../monaco/strudelFolding'
import { registerP5Providers, P5_DOCS_INDEX } from '../monaco/docs/p5'
import { registerHydraProviders, HYDRA_DOCS_INDEX } from '../monaco/docs/hydra'
import { registerSignalBusProviders } from '../monaco/docs/signals'
import { registerVizInputsHover } from './vizInputsHover'
import { registerSonicPiProviders } from '../monaco/docs/sonicpi'
import {
  buildIdentifierAlternation,
  keywordRule,
  methodRule,
} from '../monaco/docs/tokenizer-utils'
import type { WorkspaceLanguage } from './types'

/**
 * Idempotency guards. Each language is registered at most once per Monaco
 * instance. If Monaco is torn down and re-created (rare — happens in tests
 * that call `monaco.editor.dispose`), these should be reset via
 * `__resetWorkspaceLanguagesForTests()` before the next call.
 */
let hydraRegistered = false
let p5jsRegistered = false
let glslRegistered = false

function registerHydraLanguage(monaco: typeof Monaco): void {
  if (hydraRegistered) return
  const langs = monaco.languages.getLanguages()
  if (langs.some((l) => l.id === 'hydra')) {
    hydraRegistered = true
    return
  }
  hydraRegistered = true
  monaco.languages.register({ id: 'hydra' })
  // Keyword / method / variable sets derived from HYDRA_DOCS_INDEX so every
  // newly-documented symbol is also coloured. `kind: 'function'` captures
  // sources (osc, noise, shape, …); `kind: 'method'` captures chainable
  // transforms (rotate, kaleid, modulate, …); `kind: 'variable'` captures
  // the IO buffers + globals (s0..s3, o0..o3, time, mouse).
  const sources = buildIdentifierAlternation(HYDRA_DOCS_INDEX, {
    includeKinds: ['function'],
  })
  const methods = buildIdentifierAlternation(HYDRA_DOCS_INDEX, {
    includeKinds: ['method'],
  })
  const globals = buildIdentifierAlternation(HYDRA_DOCS_INDEX, {
    includeKinds: ['variable', 'constant'],
    extra: ['Math', 'PI', 'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'max', 'min', 'random', 'pow', 'sqrt'],
  })
  // Same comprehensive shape as the p5 tokenizer — operators, brackets,
  // delimiters, identifier fallthrough, template-string interpolation.
  // Previous Hydra tokenizer had only keyword/method/variable + simple
  // strings + the `=>` operator, so arithmetic (`+`, `*`, `-`), brackets,
  // property access, and user variables all fell through to the
  // undifferentiated `source.hydra` catch-all.
  monaco.languages.setMonarchTokensProvider('hydra', {
    defaultToken: '',
    tokenPostfix: '.hydra',
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        // `.foo` property access → colored as method if it's a known Hydra
        // transform, else as property identifier. Method rule runs first.
        ...methodRule(methods, 'type'),
        [/\.([a-zA-Z_$][\w$]*)/, 'identifier.property'],
        ...keywordRule(sources, 'keyword'),
        ...keywordRule(globals, 'variable.predefined'),
        [/\ba\b/, 'variable.predefined'],
        [
          /\b(let|const|var|function|for|while|if|else|return|class|new|typeof|instanceof|of|in|break|continue|do|switch|case|default|throw|try|catch|finally|async|await|yield|this|super|import|export|from|as|void|delete|null|undefined|true|false)\b/,
          'keyword',
        ],
        [/[a-zA-Z_$][\w$]*/, 'identifier'],
        [/0[xX][\da-fA-F]+n?/, 'number.hex'],
        [/0[bB][01]+n?/, 'number.binary'],
        [/\d+(\.\d+)?([eE][+-]?\d+)?n?/, 'number'],
        [/\.\d+([eE][+-]?\d+)?/, 'number.float'],
        [/"/, { token: 'string.quote', next: '@string_double' }],
        [/'/, { token: 'string.quote', next: '@string_single' }],
        [/`/, { token: 'string.quote', next: '@string_template' }],
        [/=>/, 'keyword.operator'],
        [/(\?\?|\?\.|\?|:)/, 'keyword.operator'],
        [/===|!==|==|!=|<=|>=|<<|>>>|>>|&&|\|\|/, 'keyword.operator'],
        [/[=!<>]=?/, 'keyword.operator'],
        [/[+\-*/%&|^~]=?/, 'keyword.operator'],
        [/[{}()[\]]/, '@brackets'],
        [/[;,.]/, 'delimiter'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/./, 'comment'],
      ],
      string_double: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],
      string_single: [
        [/[^\\']+/, 'string'],
        [/\\./, 'string.escape'],
        [/'/, { token: 'string.quote', next: '@pop' }],
      ],
      string_template: [
        [/[^\\`$]+/, 'string'],
        [/\\./, 'string.escape'],
        [/\$\{/, { token: 'delimiter.bracket', next: '@template_interp' }],
        [/\$/, 'string'],
        [/`/, { token: 'string.quote', next: '@pop' }],
      ],
      template_interp: [
        [/\}/, { token: 'delimiter.bracket', next: '@pop' }],
        { include: 'root' },
      ],
    },
  })
  monaco.languages.setLanguageConfiguration('hydra', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '`', close: '`' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '`', close: '`' },
    ],
  })
}

function registerP5JsLanguage(monaco: typeof Monaco): void {
  if (p5jsRegistered) return
  const langs = monaco.languages.getLanguages()
  if (langs.some((l) => l.id === 'p5js')) {
    p5jsRegistered = true
    return
  }
  p5jsRegistered = true
  monaco.languages.register({ id: 'p5js' })
  // Functions/constants/variables derived from P5_DOCS_INDEX so every
  // documented p5 identifier is also syntax-coloured. Stave-specific
  // globals (`scheduler`, `analyser`, `hapStream`) stay in `extra` since
  // they come from the host, not from p5.
  const fns = buildIdentifierAlternation(P5_DOCS_INDEX, {
    includeKinds: ['function'],
  })
  const variables = buildIdentifierAlternation(P5_DOCS_INDEX, {
    includeKinds: ['variable', 'constant'],
  })
  // Stave-specific host globals — injected into every p5 sketch by the
  // runtime. `stave` is the umbrella object; its properties are accessed
  // as `stave.scheduler`, `stave.analyser`, `stave.hapStream`, etc. The
  // property-access rule below colours the `.xxx` portion; this alternation
  // covers the bare `stave` identifier and direct-exposed aliases.
  const HOST_GLOBALS = 'stave|scheduler|analyser|hapStream'
  // Covers: JS keywords, p5 identifiers (from docs), literals, operators,
  // brackets, delimiters, numbers, strings (single / double / template
  // with ${} interpolation), comments. Previously the tokenizer only
  // matched docs-sourced identifiers + JS keywords + numbers + simple
  // strings, leaving operators / brackets / property accesses / local
  // variables rendered as undifferentiated `source.p5js` — the user-
  // visible gap in syntax colour.
  monaco.languages.setMonarchTokensProvider('p5js', {
    defaultToken: '',
    tokenPostfix: '.p5js',
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        // Host-global bare identifier (e.g. `stave` → colour as predefined
        // even when accessed as `stave.foo`). Must come before the
        // property-access rule so `.stave` stays as identifier.property.
        [new RegExp(`\\b(${HOST_GLOBALS})\\b`), 'variable.predefined'],
        // Property access: `.foo` — color the name so `obj.prop` reads as
        // property, not the same colour as bare identifiers. Must come
        // before the keyword rule so p5 names accessed as `.foo` don't
        // get mis-highlighted as top-level functions.
        [/\.([a-zA-Z_$][\w$]*)/, 'identifier.property'],
        ...keywordRule(fns, 'keyword'),
        ...keywordRule(variables, 'variable.predefined'),
        [
          /\b(let|const|var|function|for|while|if|else|return|class|new|typeof|instanceof|of|in|break|continue|do|switch|case|default|throw|try|catch|finally|async|await|yield|this|super|import|export|from|as|void|delete|null|undefined|true|false)\b/,
          'keyword',
        ],
        // Identifier fallthrough — anything left that looks like a name.
        [/[a-zA-Z_$][\w$]*/, 'identifier'],
        // Numbers: 0x…, 0b…, scientific, decimals starting with `.`.
        [/0[xX][\da-fA-F]+n?/, 'number.hex'],
        [/0[bB][01]+n?/, 'number.binary'],
        [/\d+(\.\d+)?([eE][+-]?\d+)?n?/, 'number'],
        [/\.\d+([eE][+-]?\d+)?/, 'number.float'],
        // Strings
        [/"/, { token: 'string.quote', next: '@string_double' }],
        [/'/, { token: 'string.quote', next: '@string_single' }],
        [/`/, { token: 'string.quote', next: '@string_template' }],
        // Operators + delimiters
        [/=>/, 'keyword.operator'],
        [/(\?\?|\?\.|\?|:)/, 'keyword.operator'],
        [/===|!==|==|!=|<=|>=|<<|>>>|>>|&&|\|\|/, 'keyword.operator'],
        [/[=!<>]=?/, 'keyword.operator'],
        [/[+\-*/%&|^~]=?/, 'keyword.operator'],
        [/[{}()[\]]/, '@brackets'],
        [/[;,.]/, 'delimiter'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/./, 'comment'],
      ],
      string_double: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],
      string_single: [
        [/[^\\']+/, 'string'],
        [/\\./, 'string.escape'],
        [/'/, { token: 'string.quote', next: '@pop' }],
      ],
      string_template: [
        [/[^\\`$]+/, 'string'],
        [/\\./, 'string.escape'],
        [/\$\{/, { token: 'delimiter.bracket', next: '@template_interp' }],
        [/\$/, 'string'],
        [/`/, { token: 'string.quote', next: '@pop' }],
      ],
      template_interp: [
        [/\}/, { token: 'delimiter.bracket', next: '@pop' }],
        { include: 'root' },
      ],
    },
  })
  monaco.languages.setLanguageConfiguration('p5js', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '`', close: '`' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '`', close: '`' },
    ],
  })
}

/**
 * GLSL ES 3.00 — the language of `.glsl` viz files (issue #287). Unlike the
 * `hydra` / `p5js` languages (which are JavaScript dialects), GLSL is C-like:
 * its own type system (`vec3`, `mat4`, `sampler2D`), qualifiers (`uniform`,
 * `in`/`out`), and a `#`-preprocessor. The tokenizer also highlights the Stave
 * host uniforms (`iResolution`, `iTime`, `iChannel0`, and the `u*` pattern-event
 * uniforms) as predefined so a user sees what the runtime injects — mirroring how
 * `p5js` colours `stave`/`scheduler`/`analyser`.
 */
function registerGLSLLanguage(monaco: typeof Monaco): void {
  if (glslRegistered) return
  const langs = monaco.languages.getLanguages()
  if (langs.some((l) => l.id === 'glsl')) {
    glslRegistered = true
    return
  }
  glslRegistered = true
  monaco.languages.register({ id: 'glsl' })
  monaco.languages.setMonarchTokensProvider('glsl', {
    defaultToken: '',
    tokenPostfix: '.glsl',
    // GLSL keywords / types / qualifiers / builtins, split so each colours
    // distinctly. `staveUniforms` are the host-injected uniforms (#281/#284).
    keywords: [
      'if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue',
      'discard', 'switch', 'case', 'default', 'struct', 'true', 'false',
    ],
    typeKeywords: [
      'void', 'bool', 'int', 'uint', 'float', 'double',
      'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4',
      'uvec2', 'uvec3', 'uvec4', 'bvec2', 'bvec3', 'bvec4',
      'mat2', 'mat3', 'mat4', 'mat2x2', 'mat3x3', 'mat4x4',
      'sampler2D', 'sampler3D', 'samplerCube', 'sampler2DArray',
    ],
    qualifiers: [
      'uniform', 'in', 'out', 'inout', 'const', 'attribute', 'varying',
      'precision', 'highp', 'mediump', 'lowp', 'layout', 'flat', 'smooth',
      'centroid', 'invariant',
    ],
    builtins: [
      // GLSL builtin functions + variables a shader commonly uses.
      'texture', 'textureLod', 'texelFetch', 'sin', 'cos', 'tan', 'asin',
      'acos', 'atan', 'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt',
      'abs', 'sign', 'floor', 'ceil', 'fract', 'mod', 'min', 'max', 'clamp',
      'mix', 'step', 'smoothstep', 'length', 'distance', 'dot', 'cross',
      'normalize', 'reflect', 'refract', 'radians', 'degrees',
      'gl_FragCoord', 'gl_Position', 'gl_VertexID', 'gl_FragColor',
    ],
    staveUniforms: [
      'iResolution', 'iTime', 'iMouse', 'iChannel0',
      'uKick', 'uSnare', 'uHat', 'uOpenHat', 'uClap', 'uRim', 'uTom',
      'uVelocity', 'uRms', 'uBass', 'uMid', 'uTreble', 'mainImage',
    ],
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/^[ \t]*#\w+/, 'keyword.directive'], // #version, #define, #ifdef…
        // `.xyz` / `.rgba` swizzle or member access.
        [/\.([a-zA-Z_]\w*)/, 'identifier.property'],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@typeKeywords': 'type',
              '@qualifiers': 'keyword',
              '@keywords': 'keyword',
              '@staveUniforms': 'variable.predefined',
              '@builtins': 'support.function',
              '@default': 'identifier',
            },
          },
        ],
        [/\d*\.\d+([eE][+-]?\d+)?[fF]?/, 'number.float'],
        [/\d+[fFuU]?/, 'number'],
        [/0[xX][0-9a-fA-F]+/, 'number.hex'],
        [/[{}()[\]]/, '@brackets'],
        [/[<>]=?|[!=]=?|&&|\|\||[-+*/%]=?|[?:]/, 'keyword.operator'],
        [/[;,.]/, 'delimiter'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/./, 'comment'],
      ],
    },
  })
  monaco.languages.setLanguageConfiguration('glsl', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
    ],
  })
}

/**
 * Ensure every workspace-supported Monaco language is registered on the
 * provided Monaco instance. Safe to call on every `EditorView` mount —
 * unregistered languages are registered, already-registered languages are
 * skipped. Call from `<MonacoEditor onMount>` before returning control to
 * the caller's own mount handler so the language id is valid by the time
 * any subsequent code asks for it.
 *
 * Markdown is intentionally not registered here — Monaco ships a built-in
 * `markdown` language and registering a custom one would clobber it. The
 * `WorkspaceLanguage` value `'markdown'` maps straight to Monaco's built-in
 * id of the same name.
 */
export function ensureWorkspaceLanguages(monaco: typeof Monaco): void {
  registerStrudelLanguage(monaco)
  registerSonicPiLanguage(monaco)
  registerHydraLanguage(monaco)
  registerP5JsLanguage(monaco)
  registerGLSLLanguage(monaco)
  ensureProviders('strudel', monaco, (m) => {
    registerStrudelDotCompletions(m)
    registerStrudelNoteCompletions(m)
    registerStrudelHover(m)
    // F-2 — Strudel idiom lint for `.p("name")` (double-quoted). Code
    // action provider supplies the rewrite-to-single-quotes quick fix
    // attached to the warning marker that `refreshStrudelLintMarkers`
    // publishes from EditorView per-content-change.
    if (typeof m.languages?.registerCodeActionProvider === 'function') {
      ensureStrudelLintCodeActionProvider(m, 'strudel')
    }
    // #708 — fold whole track statements (one fold per track block).
    registerStrudelFoldingProvider(m)
  })
  ensureProviders('p5js', monaco, (m) => {
    registerP5Providers(m)
    // Phase 21 — signal-bus hover/completion. p5's general dot-completion is
    // OFF by design, so the bus's TARGETED dot provider supplies `u('bd').`
    // field suggestions without polluting every `.`. Inside the same
    // ensureProviders callback so the dedupe guard covers it (idempotent on
    // re-mount).
    registerSignalBusProviders(m, 'p5js')
  })
  ensureProviders('hydra', monaco, (m) => {
    registerHydraProviders(m)
    registerSignalBusProviders(m, 'hydra')
  })
  ensureProviders('sonicpi', monaco, registerSonicPiProviders)

  // #309 — injected-globals hover (doc + live master value) for the three viz
  // languages. Separate keys so the dedupe guard is independent of the doc/
  // signal-bus providers above; glsl has no other provider block of its own.
  ensureProviders('viz-inputs-p5js', monaco, (m) => registerVizInputsHover(m, 'p5js', 'p5'))
  ensureProviders('viz-inputs-hydra', monaco, (m) => registerVizInputsHover(m, 'hydra', 'hydra'))
  ensureProviders('viz-inputs-glsl', monaco, (m) => registerVizInputsHover(m, 'glsl', 'glsl'))
}

// Per-runtime idempotency for `ensureWorkspaceLanguages` — safe on every
// EditorView mount. Monaco's provider registry is append-only, so without a
// guard, mounting N editors (or surviving N Fast-Refresh cycles) would stack
// N copies of each provider and Monaco would render every one — e.g. a hover
// doc repeated N times back-to-back (#840).
//
// The guard is stashed ON the Monaco instance, not in module scope: the
// providers live on the Monaco global, which persists across React Fast
// Refresh, whereas a module-level flag resets on every module re-eval and
// falls out of sync with the still-live registry (the #840 root cause).
// Co-locating the guard with what it guards keeps the two in lockstep across
// hot reloads and any duplicate module instances.
const PROVIDERS_GUARD_KEY = '__staveProvidersRegistered'

function registeredProviderKeys(monaco: typeof Monaco): Set<string> {
  const holder = monaco as unknown as { [PROVIDERS_GUARD_KEY]?: Set<string> }
  let set = holder[PROVIDERS_GUARD_KEY]
  if (!set) {
    set = new Set<string>()
    Object.defineProperty(monaco, PROVIDERS_GUARD_KEY, {
      value: set,
      enumerable: false,
      configurable: true,
      writable: false,
    })
  }
  return set
}

function ensureProviders(
  key: string,
  monaco: typeof Monaco,
  register: (m: typeof Monaco) => void,
): void {
  // Tests use a thin Monaco mock — skip when the required APIs are
  // absent rather than crashing on `undefined is not a function`. Checked
  // before touching the guard so a thin mock never gets the stashed marker.
  if (
    typeof monaco.languages?.registerCompletionItemProvider !== 'function' ||
    typeof monaco.languages?.registerHoverProvider !== 'function'
  ) {
    return
  }
  const registered = registeredProviderKeys(monaco)
  if (registered.has(key)) return
  registered.add(key)
  register(monaco)
}

/**
 * Map a `WorkspaceLanguage` to the Monaco language id string. The mapping
 * is currently identity — the `WorkspaceLanguage` string literals were
 * chosen to match Monaco registrations — but the function exists so that
 * any future divergence (e.g., a workspace language with dialect variants)
 * lives in one place.
 */
export function toMonacoLanguage(lang: WorkspaceLanguage): string {
  switch (lang) {
    case 'strudel':
      return 'strudel'
    case 'sonicpi':
      return 'sonicpi'
    case 'hydra':
      return 'hydra'
    case 'p5js':
      return 'p5js'
    case 'glsl':
      return 'glsl'
    case 'markdown':
      return 'markdown'
  }
}

/**
 * TESTING ONLY — reset the inline-language idempotency flags so a fresh Monaco
 * instance (test fixture) can re-register the inline `hydra` / `p5js` / `glsl`
 * languages. Does NOT reset `registerStrudelLanguage` / `registerSonicPiLanguage`
 * — those helpers own their own guards and are stable enough across tests that
 * resetting them has never been needed. The provider guard needs no reset here:
 * it lives on the Monaco instance (see `registeredProviderKeys`), so a fresh
 * Monaco fixture starts with a clean guard automatically. Not exported from the
 * barrel.
 */
export function __resetWorkspaceLanguagesForTests(): void {
  hydraRegistered = false
  p5jsRegistered = false
  glslRegistered = false
}
