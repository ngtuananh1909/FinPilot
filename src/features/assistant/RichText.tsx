import { Fragment } from "react";

/**
 * Renders model text WITHOUT HTML injection: no dangerouslySetInnerHTML. Supports only
 * `**bold**` and line breaks; headings/bullets markers are shown as plain text with the leading
 * `#`/`*` removed. Everything else stays literal text.
 */
export function splitBold(line: string): Array<{ text: string; bold: boolean }> {
  const parts: Array<{ text: string; bold: boolean }> = [];
  const re = /\*\*([^*\n]+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) parts.push({ text: line.slice(last, m.index), bold: false });
    parts.push({ text: m[1]!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last), bold: false });
  return parts.map((p) => ({ ...p, text: p.text.replace(/\*\*/g, "") }));
}

export function cleanLine(line: string): string {
  return line.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/^(\s*)\*\s+/, "$1• ").replace(/^(\s*)-\s+/, "$1• ");
}

export function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return (
    <p className="whitespace-pre-wrap break-words">
      {lines.map((line, i) => (
        <Fragment key={i}>
          {splitBold(cleanLine(line)).map((p, j) => (p.bold ? <strong key={j}>{p.text}</strong> : <Fragment key={j}>{p.text}</Fragment>))}
          {i < lines.length - 1 ? "\n" : null}
        </Fragment>
      ))}
    </p>
  );
}
