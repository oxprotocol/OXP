/**
 * Tiny zero-dependency syntax highlighter.
 *
 * Returns an array of { type, value } tokens for a small set of languages.
 * The renderer wraps each token in a <span class="tok-<type>">.
 *
 * Goals:
 *   - Lightweight (no Prism, no Shiki, no WASM).
 *   - Good-enough coverage for our doc snippets: bash, ts/js, json, rust, toml, html, wit.
 *   - Fail-safe: unknown languages render as plain text.
 */

export type TokenType =
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "type"
  | "function"
  | "punct"
  | "operator"
  | "property"
  | "tag"
  | "attr"
  | "boolean"
  | "variable"
  | "plain";

export interface Token {
  type: TokenType;
  value: string;
}

interface Rule {
  type: TokenType;
  re: RegExp;
}

const TS_KEYWORDS = new Set([
  "import",
  "export",
  "from",
  "as",
  "default",
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "new",
  "class",
  "extends",
  "implements",
  "interface",
  "type",
  "enum",
  "async",
  "await",
  "try",
  "catch",
  "finally",
  "throw",
  "this",
  "super",
  "static",
  "public",
  "private",
  "protected",
  "readonly",
  "void",
  "typeof",
  "instanceof",
  "in",
  "of",
  "yield",
  "null",
  "undefined",
]);
const TS_TYPES = new Set([
  "string",
  "number",
  "boolean",
  "object",
  "any",
  "unknown",
  "never",
  "Record",
  "Promise",
  "Array",
  "Map",
  "Set",
  "Date",
  "Error",
  "ReadonlyArray",
  "Partial",
  "Pick",
  "Omit",
]);
const TS_BOOLEANS = new Set(["true", "false", "null", "undefined"]);

const RUST_KEYWORDS = new Set([
  "fn",
  "let",
  "mut",
  "const",
  "static",
  "if",
  "else",
  "match",
  "for",
  "while",
  "loop",
  "break",
  "continue",
  "return",
  "use",
  "mod",
  "pub",
  "crate",
  "self",
  "super",
  "as",
  "impl",
  "trait",
  "struct",
  "enum",
  "where",
  "ref",
  "move",
  "async",
  "await",
  "dyn",
  "unsafe",
  "extern",
  "type",
  "in",
]);
const RUST_TYPES = new Set([
  "i8",
  "i16",
  "i32",
  "i64",
  "i128",
  "u8",
  "u16",
  "u32",
  "u64",
  "u128",
  "usize",
  "isize",
  "f32",
  "f64",
  "bool",
  "char",
  "str",
  "String",
  "Vec",
  "Option",
  "Result",
  "Box",
  "Rc",
  "Arc",
  "HashMap",
  "BTreeMap",
]);

const BASH_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "in",
  "do",
  "done",
  "while",
  "case",
  "esac",
  "function",
  "export",
  "return",
  "local",
  "echo",
  "cd",
  "ls",
  "cat",
  "pwd",
  "mkdir",
  "rm",
  "cp",
  "mv",
  "grep",
  "sed",
  "awk",
  "curl",
  "wget",
  "sudo",
  "apt",
  "brew",
  "npm",
  "pnpm",
  "yarn",
  "npx",
  "node",
  "git",
  "docker",
  "cargo",
  "rustup",
  "oxp",
]);

const WIT_KEYWORDS = new Set([
  "package",
  "interface",
  "world",
  "import",
  "export",
  "record",
  "enum",
  "variant",
  "resource",
  "func",
  "type",
  "use",
  "include",
  "with",
  "as",
  "static",
]);

function tokenize(rules: Rule[], src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    let matched = false;
    for (const r of rules) {
      r.re.lastIndex = 0;
      const m = r.re.exec(src.slice(i));
      if (m && m.index === 0) {
        out.push({ type: r.type, value: m[0] });
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const last = out[out.length - 1];
      if (last && last.type === "plain") last.value += src[i];
      else out.push({ type: "plain", value: src[i] });
      i++;
    }
  }
  return out;
}

function classifyIdent(
  set: Set<string>,
  types: Set<string> | null,
  bools: Set<string> | null,
) {
  return (value: string): TokenType => {
    if (bools?.has(value)) return "boolean";
    if (set.has(value)) return "keyword";
    if (types?.has(value)) return "type";
    return "plain";
  };
}

function highlightTs(src: string): Token[] {
  const rules: Rule[] = [
    { type: "comment", re: /\/\*[\s\S]*?\*\// },
    { type: "comment", re: /\/\/.*/ },
    { type: "string", re: /`(?:\\.|[^`\\])*`/ },
    { type: "string", re: /"(?:\\.|[^"\\])*"/ },
    { type: "string", re: /'(?:\\.|[^'\\])*'/ },
    {
      type: "number",
      re: /\b(?:0x[\da-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d+)?)\b/,
    },
    { type: "plain", re: /[A-Za-z_$][\w$]*/ },
    {
      type: "operator",
      re: /=>|===|!==|==|!=|<=|>=|&&|\|\||\?\?|\+\+|--|[+\-*/%&|^!?:=<>]/,
    },
    { type: "punct", re: /[{}[\]();,.]/ },
    { type: "plain", re: /\s+/ },
  ];
  const cls = classifyIdent(TS_KEYWORDS, TS_TYPES, TS_BOOLEANS);
  const toks = tokenize(rules, src);
  // Re-classify identifiers and detect call sites.
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === "plain" && /^[A-Za-z_$][\w$]*$/.test(t.value)) {
      const k = cls(t.value);
      if (k !== "plain") {
        t.type = k;
        continue;
      }
      const next = toks[i + 1];
      if (next && next.type === "punct" && next.value === "(") {
        t.type = "function";
      } else if (/^[A-Z]/.test(t.value)) {
        t.type = "type";
      }
    }
  }
  return toks;
}

function highlightRust(src: string): Token[] {
  const rules: Rule[] = [
    { type: "comment", re: /\/\*[\s\S]*?\*\// },
    { type: "comment", re: /\/\/.*/ },
    { type: "string", re: /"(?:\\.|[^"\\])*"/ },
    { type: "string", re: /'(?:\\.|[^'\\])*'/ },
    {
      type: "number",
      re: /\b\d[\d_]*(?:\.\d[\d_]*)?(?:[iuf](?:8|16|32|64|128|size))?\b/,
    },
    { type: "plain", re: /[A-Za-z_][\w]*!?/ },
    { type: "operator", re: /->|=>|::|==|!=|<=|>=|&&|\|\||[+\-*/%&|^!?:=<>]/ },
    { type: "punct", re: /[{}[\]();,.]/ },
    { type: "plain", re: /\s+/ },
  ];
  const toks = tokenize(rules, src);
  const cls = classifyIdent(
    RUST_KEYWORDS,
    RUST_TYPES,
    new Set(["true", "false"]),
  );
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === "plain" && /^[A-Za-z_][\w]*!?$/.test(t.value)) {
      if (t.value.endsWith("!")) {
        t.type = "function";
        continue;
      }
      const k = cls(t.value);
      if (k !== "plain") {
        t.type = k;
        continue;
      }
      const next = toks[i + 1];
      if (next && next.type === "punct" && next.value === "(")
        t.type = "function";
      else if (/^[A-Z]/.test(t.value)) t.type = "type";
    }
  }
  return toks;
}

function highlightBash(src: string): Token[] {
  const rules: Rule[] = [
    { type: "comment", re: /#.*/ },
    { type: "string", re: /"(?:\\.|[^"\\])*"/ },
    { type: "string", re: /'[^']*'/ },
    { type: "variable", re: /\$\{[^}]+\}|\$[A-Za-z_][\w]*/ },
    { type: "number", re: /\b\d+\b/ },
    { type: "plain", re: /[A-Za-z_][\w-]*/ },
    { type: "operator", re: /\|\||&&|>>|<<|[|&;<>=]/ },
    { type: "punct", re: /[{}[\]()`]/ },
    { type: "plain", re: /\s+/ },
  ];
  const toks = tokenize(rules, src);
  // First word of each statement is a command; flags start with `-`.
  let atStart = true;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === "operator" && /[;|&]/.test(t.value)) {
      atStart = true;
      continue;
    }
    if (/\n/.test(t.value)) {
      atStart = true;
    }
    if (t.type !== "plain") continue;
    if (/^\s+$/.test(t.value)) continue;
    if (t.value.startsWith("-")) {
      t.type = "attr";
      continue;
    }
    if (atStart && BASH_KEYWORDS.has(t.value)) {
      t.type = "keyword";
      atStart = false;
      continue;
    }
    if (atStart && /^[A-Za-z_][\w-]*$/.test(t.value)) {
      t.type = "function";
      atStart = false;
      continue;
    }
    atStart = false;
  }
  return toks;
}

function highlightJson(src: string): Token[] {
  const rules: Rule[] = [
    { type: "comment", re: /\/\/.*/ },
    { type: "property", re: /"(?:\\.|[^"\\])*"(?=\s*:)/ },
    { type: "string", re: /"(?:\\.|[^"\\])*"/ },
    { type: "number", re: /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/ },
    { type: "boolean", re: /\b(?:true|false|null)\b/ },
    { type: "punct", re: /[{}[\],:]/ },
    { type: "plain", re: /\s+/ },
    { type: "plain", re: /./ },
  ];
  return tokenize(rules, src);
}

function highlightToml(src: string): Token[] {
  const rules: Rule[] = [
    { type: "comment", re: /#.*/ },
    { type: "tag", re: /^\s*\[\[?[^\]]+\]\]?/m },
    { type: "property", re: /[A-Za-z_][\w-]*(?=\s*=)/ },
    { type: "string", re: /"(?:\\.|[^"\\])*"/ },
    { type: "string", re: /'[^']*'/ },
    { type: "number", re: /-?\d+(?:\.\d+)?/ },
    { type: "boolean", re: /\b(?:true|false)\b/ },
    { type: "punct", re: /[{}[\],=]/ },
    { type: "plain", re: /\s+/ },
    { type: "plain", re: /./ },
  ];
  return tokenize(rules, src);
}

function highlightWit(src: string): Token[] {
  const rules: Rule[] = [
    { type: "comment", re: /\/\/.*/ },
    { type: "string", re: /"(?:\\.|[^"\\])*"/ },
    { type: "plain", re: /[A-Za-z_][\w-]*/ },
    { type: "operator", re: /->|=>|::|[:,;.@]/ },
    { type: "punct", re: /[{}[\]()<>]/ },
    { type: "plain", re: /\s+/ },
  ];
  const toks = tokenize(rules, src);
  const cls = classifyIdent(WIT_KEYWORDS, null, null);
  for (const t of toks) {
    if (t.type === "plain" && /^[A-Za-z_][\w-]*$/.test(t.value)) {
      const k = cls(t.value);
      if (k !== "plain") t.type = k;
    }
  }
  return toks;
}

function highlightHtml(src: string): Token[] {
  const rules: Rule[] = [
    { type: "comment", re: /<!--[\s\S]*?-->/ },
    { type: "string", re: /"(?:\\.|[^"\\])*"/ },
    { type: "string", re: /'[^']*'/ },
    { type: "tag", re: /<\/?[A-Za-z][\w-]*|\/?>/ },
    { type: "attr", re: /\b[a-zA-Z-]+(?==)/ },
    { type: "punct", re: /[=<>]/ },
    { type: "plain", re: /[^<>"'=]+/ },
    { type: "plain", re: /./ },
  ];
  return tokenize(rules, src);
}

export function highlight(code: string, lang?: string): Token[] {
  switch ((lang || "").toLowerCase()) {
    case "ts":
    case "tsx":
    case "typescript":
    case "js":
    case "jsx":
    case "javascript":
      return highlightTs(code);
    case "rs":
    case "rust":
      return highlightRust(code);
    case "sh":
    case "bash":
    case "shell":
    case "zsh":
      return highlightBash(code);
    case "json":
    case "jsonc":
      return highlightJson(code);
    case "toml":
    case "ini":
      return highlightToml(code);
    case "wit":
      return highlightWit(code);
    case "html":
    case "xml":
    case "svg":
      return highlightHtml(code);
    default:
      return [{ type: "plain", value: code }];
  }
}
