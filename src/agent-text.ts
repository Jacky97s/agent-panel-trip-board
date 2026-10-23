export type Inline = { text: string; strong: boolean };
export type Block = { kind: 'para'; lines: Inline[][] } | { kind: 'list'; items: Inline[][] };

/** Real agents answer in Markdown; this covers the subset they use in short replies (paragraphs, `-` lists, bold, code). */
export function parseAgentText(source: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of source.trim().split(/\n\s*\n/)) {
    const lines = chunk.split('\n').filter((line) => line.trim());
    if (lines.length === 0) continue;
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      blocks.push({ kind: 'list', items: lines.map((line) => inline(line.replace(/^\s*[-*]\s+/, ''))) });
    } else {
      blocks.push({ kind: 'para', lines: lines.map(inline) });
    }
  }
  return blocks;
}

function inline(line: string): Inline[] {
  return line
    .replace(/`([^`]+)`/g, '$1')
    .split(/\*\*([^*]+)\*\*/)
    .map((text, index) => ({ text, strong: index % 2 === 1 }))
    .filter((part) => part.text);
}
