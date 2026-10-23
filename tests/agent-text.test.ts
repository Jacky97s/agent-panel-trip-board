import { describe, expect, it } from 'vitest';
import { parseAgentText } from '../src/agent-text.ts';

describe('parseAgentText', () => {
  it('turns a Markdown reply into paragraphs and lists without literal markers', () => {
    const blocks = parseAgentText('我把 `d4-lunch` 換掉了。\n\n- **類型**：溫泉\n- **費用**：¥9,000\n\n時間有點趕。');
    expect(blocks).toEqual([
      { kind: 'para', lines: [[{ text: '我把 d4-lunch 換掉了。', strong: false }]] },
      {
        kind: 'list',
        items: [
          [{ text: '類型', strong: true }, { text: '：溫泉', strong: false }],
          [{ text: '費用', strong: true }, { text: '：¥9,000', strong: false }],
        ],
      },
      { kind: 'para', lines: [[{ text: '時間有點趕。', strong: false }]] },
    ]);
  });

  it('keeps plain text from the demo peer as one paragraph', () => {
    expect(parseAgentText('已排好 11/15。')).toEqual([
      { kind: 'para', lines: [[{ text: '已排好 11/15。', strong: false }]] },
    ]);
  });
});
