import type * as Monaco from 'monaco-editor'
import { SONICPI_DOCS_INDEX } from './docs/sonicpi'
import { buildIdentifierAlternation } from './docs/tokenizer-utils'
import { JS_KEYWORDS } from './jsKeywords'
import { TEMPO_SETTERS } from '../codeView'

/** Every name Strudel registers its one tempo setter under, as whole words (#1954). */
const TEMPO_SETTER_TOKEN = new RegExp(TEMPO_SETTERS.map((n) => `\\b${n}\\b`).join('|'))

export function registerSonicPiLanguage(monaco: typeof Monaco): void {
  const langs = monaco.languages.getLanguages()
  if (langs.some((l) => l.id === 'sonicpi')) return

  monaco.languages.register({ id: 'sonicpi' })

  // Two token-classes restore the prior visual distinction:
  //
  //   sonicpi.music    — pitch + randomness + ring helpers that feel
  //                      mathematical (choose, rrand, ring, range, chord,
  //                      scale, note, tick, …). All western_theory / maths
  //                      categories + a curated list of random/ring fns.
  //   sonicpi.function — DSL flow / audio / MIDI (play, sleep, live_loop,
  //                      sample, synth, with_fx, use_bpm, cc, …).
  //
  // Symbols (`:dull_bell`) hit the `:\w+` rule below; synth / fx / sample
  // kinds are dropped from both alternations.
  const MUSIC_HELPER_NAMES = new Set([
    'choose', 'rrand', 'rrand_i', 'rand', 'rand_i', 'dice', 'one_in',
    'ring', 'knit', 'range', 'line', 'spread', 'tick', 'look',
    'shuffle', 'sort_by', 'reflect', 'stretch', 'repeat', 'mirror',
  ])
  const musicFns = buildIdentifierAlternation(SONICPI_DOCS_INDEX, {
    excludeKinds: ['synth', 'fx', 'sample'],
    filter: (name, doc) =>
      doc.category === 'western_theory' ||
      doc.category === 'maths' ||
      MUSIC_HELPER_NAMES.has(name),
  })
  const dslFns = buildIdentifierAlternation(SONICPI_DOCS_INDEX, {
    excludeKinds: ['synth', 'fx', 'sample'],
    filter: (name, doc) =>
      doc.category !== 'western_theory' &&
      doc.category !== 'maths' &&
      !MUSIC_HELPER_NAMES.has(name),
    extra: ['puts', 'print'],
  })

  monaco.languages.setMonarchTokensProvider('sonicpi', {
    defaultToken: '',
    tokenPostfix: '.sonicpi',

    keywords: [
      'do', 'end', 'if', 'else', 'elsif', 'unless', 'loop', 'while', 'until',
      'for', 'in', 'begin', 'rescue', 'ensure', 'true', 'false', 'nil', 'and', 'or', 'not',
    ],

    tokenizer: {
      root: [
        // Ruby comment
        [/#.*$/, 'comment'],

        // Ruby symbols :name
        [/:\w+/, 'sonicpi.symbol'],

        // Keyword args (release:, amp:, rate:) — BEFORE the fn rule so
        // `amp:` doesn't get classified as the `amp` function.
        [/\b[a-z_]\w*:/, 'sonicpi.kwarg'],

        // Keywords first — `end` / `do` would otherwise match the function
        // list (Sonic Pi has many fns named alike, but these are lexical).
        [/\b(do|end|if|else|elsif|unless|loop|while|until|for|in|true|false|nil|and|or|not|begin|rescue|ensure|return|yield|then|when|case|break|next|redo|retry|module|class|def|lambda|proc|self)\b/, 'keyword'],

        // Music helpers (mathy / pitch / randomness) — pink-tinted class.
        [new RegExp(`\\b(${musicFns})\\b`), 'sonicpi.music'],

        // DSL / sound / MIDI functions — blue-tinted class.
        [new RegExp(`\\b(${dslFns})\\b`), 'sonicpi.function'],

        // Note names: c3, eb4, f#2
        [/\b[a-gA-G][bs#]?\d\b/, 'sonicpi.note'],

        // Identifier fallthrough — user variables, iterator names, etc.
        [/[a-zA-Z_][\w]*/, 'identifier'],

        // Numbers
        [/0x[\da-fA-F]+/, 'number.hex'],
        [/\d+(\.\d+)?([eE][+-]?\d+)?/, 'number'],

        // Strings
        [/"/, { token: 'string.quote', next: '@string_double' }],
        [/'/, { token: 'string.quote', next: '@string_single' }],

        // Operators + delimiters
        [/=>|<=>|==|!=|<=|>=|&&|\|\||\.\.\.?/, 'keyword.operator'],
        [/[=!<>]=?/, 'keyword.operator'],
        [/[+\-*/%&|^~]=?/, 'keyword.operator'],
        [/[{}()[\]]/, '@brackets'],
        [/[;,.]/, 'delimiter'],
      ],

      string_double: [
        [/#\{/, { token: 'string.interpolation', next: '@interpolation' }],
        [/\\./, 'string.escape'],
        [/[^"#\\]+/, 'string'],
        [/#/, 'string'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],

      string_single: [
        [/\\./, 'string.escape'],
        [/[^'\\]+/, 'string'],
        [/'/, { token: 'string.quote', next: '@pop' }],
      ],

      interpolation: [
        [/\}/, { token: 'string.interpolation', next: '@pop' }],
        { include: 'root' },
      ],
    },
  })

  monaco.languages.setLanguageConfiguration('sonicpi', {
    comments: {
      lineComment: '#',
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  })
}

export function registerStrudelLanguage(monaco: typeof Monaco): void {
  // Only register once
  const langs = monaco.languages.getLanguages()
  if (langs.some((l) => l.id === 'strudel')) return

  monaco.languages.register({ id: 'strudel' })

  monaco.languages.setMonarchTokensProvider('strudel', {
    defaultToken: '',
    tokenPostfix: '.strudel',

    // Keyword list is borrowed from Monaco's own JS/TS grammar (generated into
    // jsKeywords.ts), not hand-maintained. Used by the `@keywords` cases below.
    keywords: [...JS_KEYWORDS],

    tokenizer: {
      root: [
        // $: pattern-start marker
        [/\$\s*:/, 'strudel.pattern-start'],

        // tempo: setcps / setCps / setcpm / setCpm, from the one list (#1954)
        [TEMPO_SETTER_TOKEN, 'strudel.tempo'],

        // Note names: c3, eb4, f#2, C#5
        [/\b[a-gA-G][b#]?\d\b/, 'strudel.note'],

        // Comments — before the call/identifier rules so a `// gain(0.5)` line
        // isn't tokenized as a call inside the comment.
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@block_comment'],

        // Strings (mini-notation)
        [/"/, 'string', '@mini_string_double'],
        [/'/, 'string', '@mini_string_single'],
        [/`/, 'string', '@template_string'],

        // Function highlighting — structural, like Strudel's own CodeMirror
        // editor: color every call by SHAPE, not from a fixed vocabulary. The
        // `@keywords` case lets Monaco's own keyword list veto function-coloring,
        // so `if (`, `for (` stay keywords rather than calls.
        //   .method( → chained call  (.lpf, .crush, .gain) — only when a call,
        //   so a property access (x.currentTime, Math.PI) stays plain below.
        [/(\.)([a-zA-Z_$][\w$]*)(?=\s*\()/, ['delimiter', 'strudel.function']],
        //   .property → member access, no call: plain identifier
        [/(\.)([a-zA-Z_$][\w$]*)/, ['delimiter', 'identifier']],
        //   name(   → bare call     (s(, note(, stack()
        [
          /\b([a-zA-Z_$][\w$]*)(?=\s*\()/,
          { cases: { '@keywords': 'keyword', '@default': 'strudel.function' } },
        ],

        // Remaining identifiers: a JS keyword (const, let, true, …) or a plain
        // variable name. Keeps keywords distinct from variables.
        [
          /\b[a-zA-Z_$][\w$]*\b/,
          { cases: { '@keywords': 'keyword', '@default': 'identifier' } },
        ],

        // Numbers
        [/\b\d+(\.\d+)?\b/, 'number'],

        // JS operators & separators. Brackets are left to Monaco's bracket-pair
        // colorization. No regex-literal handling — avoids the `/` misfire.
        [/[=+\-*/%<>!&|?:~^]+/, 'keyword.operator'],
        [/[,;]/, 'delimiter'],
      ],

      block_comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],

      // Mini-notation states. The whitespace + word rules are what let EVERY
      // element re-enter the note/operator/number rules — a greedy `[^"]+`
      // fallback would otherwise swallow the rest of the string after the
      // first token (so `"c3 e3 g3"` only colored `c3`). Operator class covers
      // `:` (sample index, bd:3), `-` (rest) and `.` (subdivision) too.
      mini_string_double: [
        [/[~*!%?@<>\[\]{}|,_:.\-]/, 'strudel.mini.operator'],
        [/[a-gA-G][b#]?\d?/, 'strudel.mini.note'],
        [/\d+(\.\d+)?/, 'strudel.mini.number'],
        [/\s+/, 'white'],
        [/[a-zA-Z][\w]*/, 'string'], // sample/word names (hh, sawtooth, …)
        [/"/, 'string', '@pop'],
        [/[^"]/, 'string'],
      ],

      mini_string_single: [
        [/[~*!%?@<>\[\]{}|,_:.\-]/, 'strudel.mini.operator'],
        [/[a-gA-G][b#]?\d?/, 'strudel.mini.note'],
        [/\d+(\.\d+)?/, 'strudel.mini.number'],
        [/\s+/, 'white'],
        [/[a-zA-Z][\w]*/, 'string'],
        [/'/, 'string', '@pop'],
        [/[^']/, 'string'],
      ],

      // Backtick strings are Strudel's multi-line mini-notation form, so they
      // tokenize like the quoted ones — plus `${…}` interpolation, which drops
      // to `root` for normal JS/Strudel highlighting.
      template_string: [
        [/\$\{/, { token: 'delimiter.strudel', next: '@template_interp' }],
        [/[~*!%?@<>\[\]{}|,_:.\-]/, 'strudel.mini.operator'],
        [/[a-gA-G][b#]?\d?/, 'strudel.mini.note'],
        [/\d+(\.\d+)?/, 'strudel.mini.number'],
        [/\s+/, 'white'],
        [/[a-zA-Z][\w]*/, 'string'],
        [/`/, 'string', '@pop'],
        [/[^`$]/, 'string'],
        [/\$/, 'string'],
      ],

      template_interp: [
        [/\}/, { token: 'delimiter.strudel', next: '@pop' }],
        { include: 'root' },
      ],
    },
  })

  monaco.languages.setLanguageConfiguration('strudel', {
    comments: {
      lineComment: '//',
      blockComment: ['/*', '*/'],
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
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
    ],
  })
}
