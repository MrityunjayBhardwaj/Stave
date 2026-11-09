/**
 * #2491 — colouring for the gallery's code viewer.
 *
 * The gallery shows other people's code as text and never runs it (#2304), so
 * the colouring is a small scanner over the characters: it splits a line into
 * comments, strings, numbers, keywords and function names, and the viewer draws
 * each piece as a React text node — never as HTML, so nothing in the code can
 * become markup.
 *
 * It reads Strudel, Hydra and p5 (all JavaScript) and GLSL (the same comment,
 * string and number shapes, with its own keywords). It is a highlighter, not a
 * parser: an odd construct is coloured plainly, never refused.
 */

export type TokenKind = "comment" | "string" | "number" | "keyword" | "function" | "plain";

export interface Token {
  kind: TokenKind;
  text: string;
}

const JS_KEYWORDS = [
  "async", "await", "break", "case", "catch", "class", "const", "continue", "default", "delete", "do", "else",
  "export", "extends", "false", "finally", "for", "from", "function", "if", "import", "in", "instanceof", "let",
  "new", "null", "of", "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof",
  "undefined", "var", "void", "while", "yield",
];

/** Strudel's ways of putting patterns together read as structure, not as a sound or an effect. */
const STRUDEL_STRUCTURE = ["stack", "cat", "seq", "sequence", "fastcat", "slowcat", "timeCat", "arrange", "polymeter"];

const GLSL_KEYWORDS = [
  "attribute", "bool", "break", "bvec2", "bvec3", "bvec4", "const", "continue", "discard", "do", "else", "false",
  "float", "for", "highp", "if", "in", "inout", "int", "ivec2", "ivec3", "ivec4", "lowp", "mat2", "mat3", "mat4",
  "mediump", "out", "precision", "return", "sampler2D", "struct", "true", "uniform", "varying", "vec2", "vec3",
  "vec4", "void", "while",
];

export type CodeLanguage = "js" | "glsl";

const KEYWORDS: Record<CodeLanguage, ReadonlySet<string>> = {
  js: new Set([...JS_KEYWORDS, ...STRUDEL_STRUCTURE]),
  glsl: new Set(GLSL_KEYWORDS),
};

/** Which scanner a file's path asks for: GLSL by its extension, JavaScript otherwise. */
export function codeLanguageOf(path: string): CodeLanguage {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return ext === "glsl" || ext === "frag" || ext === "vert" || ext === "shader" ? "glsl" : "js";
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

/**
 * The code split into lines, each a list of tokens. A block comment or a
 * template string that runs over several lines is coloured on every line it
 * covers. Joining every token's text, line by line with "\n", gives the code back
 * exactly.
 */
export function colourLines(code: string, language: CodeLanguage = "js"): Token[][] {
  const keywords = KEYWORDS[language];
  const lines: Token[][] = [[]];
  const push = (kind: TokenKind, text: string) => {
    // A token spanning lines is cut at each newline, so every line stands alone.
    const parts = text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (!part) return;
      const line = lines[lines.length - 1];
      const last = line[line.length - 1];
      if (last && last.kind === kind) last.text += part;
      else line.push({ kind, text: part });
    });
  };

  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    const next = code[i + 1];

    // Comments: // to the end of the line, /* … */ (to the end of the code if never closed).
    if (ch === "/" && next === "/") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      push("comment", code.slice(i, stop));
      i = stop;
      continue;
    }

    // Strings: '…', "…" (stop at the line's end if unclosed) and `…` (may span lines).
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n && code[j] !== ch) {
        if (code[j] === "\\") j += 1;
        else if (code[j] === "\n" && ch !== "`") break;
        j += 1;
      }
      const stop = j < n && code[j] === ch ? j + 1 : j;
      push("string", code.slice(i, stop));
      i = stop;
      continue;
    }

    // Numbers: 12, 0.5, .5, 1e3, 0xff — not the digits inside a name.
    if (DIGIT.test(ch) || (ch === "." && next !== undefined && DIGIT.test(next))) {
      let j = i;
      if (ch === "0" && (next === "x" || next === "X")) {
        j += 2;
        while (j < n && /[0-9a-fA-F]/.test(code[j])) j += 1;
      } else {
        while (j < n && /[0-9.]/.test(code[j])) j += 1;
        if (j < n && (code[j] === "e" || code[j] === "E") && /[0-9+-]/.test(code[j + 1] ?? "")) {
          j += 2;
          while (j < n && DIGIT.test(code[j])) j += 1;
        }
      }
      push("number", code.slice(i, j));
      i = j;
      continue;
    }

    // Names: a keyword, a function (a name followed by a call), or plain.
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < n && IDENT.test(code[j])) j += 1;
      const word = code.slice(i, j);
      let k = j;
      while (k < n && (code[k] === " " || code[k] === "\t")) k += 1;
      const called = code[k] === "(";
      const kind: TokenKind = keywords.has(word) ? "keyword" : called ? "function" : "plain";
      push(kind, word);
      i = j;
      continue;
    }

    push("plain", ch);
    i += 1;
  }
  return lines;
}
