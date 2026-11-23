// JSON that is safe to put inside <script type="application/json" set:html={...}>.
// JSON.stringify leaves "<" alone, so text such as "</script><script>..." (for example from an AI-written word)
// would close the tag early and run as code. Here "<", ">", "&" and the two JS line separators become escape
// sequences; JSON.parse reads them back as the same characters.
const LS = new RegExp(String.fromCharCode(0x2028), "g");
const PS = new RegExp(String.fromCharCode(0x2029), "g");

export function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LS, "\\u2028")
    .replace(PS, "\\u2029");
}
