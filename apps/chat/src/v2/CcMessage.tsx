import type { V2Memory, V2Tokens } from './types';
import type { AttachmentMeta } from '../lib/types';
import { CcCitation } from './atoms';
import { CcImageGrid } from './CcImageGrid';

export interface V2Message {
  id: string;
  role: 'user' | 'assistant';
  time: string;
  content: string;
  model?: string;
  tokens?: V2Tokens;
  recalled?: V2Memory[];
  attachments?: AttachmentMeta[];
}

/**
 * Minimal message renderer. The design prototype ships a structured body
 * AST (p/ul/li/pre) with embedded `{cite: memoryId}` nodes; our live data
 * is plain text, so we:
 *   - render paragraphs by splitting on blank lines
 *   - render fenced code blocks (```lang ... ```) as <pre>
 *   - append ◈ citations at the end of the last paragraph when
 *     `showCitations` is on and the message has recalled memories
 */
export function CcMessage({
  msg,
  showCitations,
}: {
  msg: V2Message;
  showCitations: boolean;
}) {
  const isUser = msg.role === 'user';
  const saved = msg.tokens ? msg.tokens.frontier - msg.tokens.clude : 0;
  const showSavings = !isUser && msg.tokens && saved > 0;

  const blocks = parseBody(msg.content);
  const lastIdx = blocks.length - 1;

  return (
    <article className="cc-msg">
      <div className="cc-msg__head">
        <span className={`cc-msg__role ${isUser ? '' : 'cc-msg__role--assistant'}`}>
          {isUser ? 'You' : 'Clude'}
        </span>
        <span className="cc-msg__sep">·</span>
        <span>{msg.time}</span>
        {!isUser && msg.model && (
          <>
            <span className="cc-msg__sep">·</span>
            <span>{msg.model}</span>
          </>
        )}
      </div>
      <div className="cc-msg__body">
        {msg.attachments && msg.attachments.length > 0 && (
          <CcImageGrid images={msg.attachments} />
        )}
        {blocks.map((b, i) =>
          b.kind === 'pre' ? (
            <pre key={i}>{b.text}</pre>
          ) : (
            <p key={i}>
              {b.text}
              {!isUser &&
                showCitations &&
                i === lastIdx &&
                msg.recalled?.map((m) => (
                  <CcCitation key={String(m.id)} memory={m} />
                ))}
            </p>
          ),
        )}
      </div>

      {showSavings && msg.tokens && (
        <div className="cc-msg__foot">
          <span
            className="cc-msg__footitem cc-msg__footitem--saved"
            title={`vs ${msg.tokens.model}`}
          >
            <span className="cc-msg__footitem__val">−{saved.toLocaleString()} tok</span>
            <span style={{ opacity: 0.55 }}>vs {msg.tokens.model}</span>
          </span>
        </div>
      )}
    </article>
  );
}

type Block = { kind: 'p' | 'pre'; text: string };

function parseBody(raw: string): Block[] {
  if (!raw) return [{ kind: 'p', text: '' }];
  const blocks: Block[] = [];
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) {
      pushParagraphs(blocks, raw.slice(last, m.index));
    }
    blocks.push({ kind: 'pre', text: m[1].replace(/\n$/, '') });
    last = re.lastIndex;
  }
  if (last < raw.length) pushParagraphs(blocks, raw.slice(last));
  return blocks.length ? blocks : [{ kind: 'p', text: raw }];
}

function pushParagraphs(blocks: Block[], chunk: string) {
  const paras = chunk.split(/\n{2,}/);
  for (const p of paras) {
    const text = p.trim();
    if (text) blocks.push({ kind: 'p', text });
  }
}
