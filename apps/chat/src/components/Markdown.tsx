import { useMemo } from 'react';

/**
 * Lightweight markdown renderer for chat messages.
 * Handles: **bold**, *italic*, `code`, ```code blocks```, [links](url), - lists, headings
 */
export function Markdown({ content }: { content: string }) {
  const rendered = useMemo(() => renderMarkdown(content), [content]);
  return <div className="text-white/90 text-[13px] leading-relaxed markdown-content" dangerouslySetInnerHTML={{ __html: rendered }} />;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(text: string): string {
  let result = escapeHtml(text);
  // Code spans first (prevents inner parsing)
  result = result.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Links
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>');
  return result;
}

function renderMarkdown(text: string): string {
  const lines = text.split('\n');
  const html: string[] = [];
  let i = 0;
  let inCodeBlock = false;
  let codeLines: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    // Code blocks
    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLines = [];
        i++;
        continue;
      } else {
        inCodeBlock = false;
        html.push(`<pre class="md-pre"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        i++;
        continue;
      }
    }
    if (inCodeBlock) {
      codeLines.push(line);
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      html.push('');
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html.push(`<h${level} class="md-h${level}">${renderInline(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Unordered list items (-, *, •)
    if (/^[\s]*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*[-*•]\s+/, ''));
        i++;
      }
      html.push('<ul class="md-ul">' + items.map(item => `<li>${renderInline(item)}</li>`).join('') + '</ul>');
      continue;
    }

    // Ordered list items
    if (/^[\s]*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*\d+[.)]\s+/, ''));
        i++;
      }
      html.push('<ol class="md-ol">' + items.map(item => `<li>${renderInline(item)}</li>`).join('') + '</ol>');
      continue;
    }

    // Regular paragraph
    html.push(`<p>${renderInline(line)}</p>`);
    i++;
  }

  // Unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    html.push(`<pre class="md-pre"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }

  return html.join('\n');
}
