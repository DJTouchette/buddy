import React from "react";

interface JiraMarkdownProps {
  content: string | object;
  onTicketClick?: (ticketKey: string) => void;
}

// Ticket key pattern (e.g., CAS-123, PROJ-456)
const TICKET_KEY_PATTERN = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

// Parse JIRA wiki markup to React elements
function parseWikiMarkup(text: string, onTicketClick?: (key: string) => void): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  // Process line by line for block elements
  const lines = remaining.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Headers: h1. through h6. (JIRA style)
    const headerMatch = line.match(/^h([1-6])\.\s*(.*)$/);
    if (headerMatch) {
      const level = parseInt(headerMatch[1]);
      const content = headerMatch[2];
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      elements.push(
        <Tag key={key++} className="jira-header">
          {parseInline(content, onTicketClick)}
        </Tag>
      );
      i++;
      continue;
    }

    // Headers: # through ###### (Markdown style)
    // Only treat as header if next line is NOT also a # line (to distinguish from JIRA ordered lists)
    const mdHeaderMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (mdHeaderMatch) {
      const nextLine = lines[i + 1];
      const isListContext = nextLine && nextLine.match(/^#+\s/);
      if (!isListContext) {
        const level = mdHeaderMatch[1].length;
        const content = mdHeaderMatch[2];
        const Tag = `h${level}` as keyof JSX.IntrinsicElements;
        elements.push(
          <Tag key={key++} className="jira-header">
            {parseInline(content, onTicketClick)}
          </Tag>
        );
        i++;
        continue;
      }
    }

    // Code blocks: {code}...{code} or {code:language}...{code} (JIRA style)
    if (line.match(/^\{code(:[^}]*)?\}/)) {
      const codeLines: string[] = [];
      const langMatch = line.match(/^\{code:([^}]*)\}/);
      const language = langMatch ? langMatch[1] : "";
      i++;
      while (i < lines.length && !lines[i].match(/^\{code\}/)) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing {code}
      elements.push(
        <pre key={key++} className="jira-code-block" data-language={language}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Code blocks: ```language ... ``` (Markdown style)
    if (line.match(/^```/)) {
      const codeLines: string[] = [];
      const language = line.slice(3).trim();
      i++;
      while (i < lines.length && !lines[i].match(/^```$/)) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```
      elements.push(
        <pre key={key++} className="jira-code-block" data-language={language}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Panels: {panel}...{panel}
    if (line.match(/^\{panel(:[^}]*)?\}/)) {
      const panelLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].match(/^\{panel\}/)) {
        panelLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing {panel}
      elements.push(
        <div key={key++} className="jira-panel">
          {parseWikiMarkup(panelLines.join("\n"), onTicketClick)}
        </div>
      );
      continue;
    }

    // Quote blocks: {quote}...{quote}
    if (line.match(/^\{quote\}/)) {
      const quoteLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].match(/^\{quote\}/)) {
        quoteLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing {quote}
      elements.push(
        <blockquote key={key++} className="jira-quote">
          {parseWikiMarkup(quoteLines.join("\n"), onTicketClick)}
        </blockquote>
      );
      continue;
    }

    // Noformat blocks: {noformat}...{noformat}
    if (line.match(/^\{noformat\}/)) {
      const noformatLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].match(/^\{noformat\}/)) {
        noformatLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing {noformat}
      elements.push(
        <pre key={key++} className="jira-noformat">
          {noformatLines.join("\n")}
        </pre>
      );
      continue;
    }

    // Unordered lists: * item, ** nested item (JIRA style)
    if (line.match(/^\*+\s/)) {
      const listItems: { level: number; content: string }[] = [];
      while (i < lines.length && lines[i].match(/^\*+\s/)) {
        const match = lines[i].match(/^(\*+)\s(.*)$/);
        if (match) {
          listItems.push({ level: match[1].length, content: match[2] });
        }
        i++;
      }
      elements.push(
        <ul key={key++} className="jira-list">
          {renderListItems(listItems, onTicketClick)}
        </ul>
      );
      continue;
    }

    // Unordered lists: - item (Markdown style)
    if (line.match(/^-\s+/)) {
      const listItems: { level: number; content: string }[] = [];
      while (i < lines.length && lines[i].match(/^(\s*)-\s+/)) {
        const match = lines[i].match(/^(\s*)-\s+(.*)$/);
        if (match) {
          // Calculate indent level (every 2 spaces = 1 level)
          const indent = match[1].length;
          const level = Math.floor(indent / 2) + 1;
          listItems.push({ level, content: match[2] });
        }
        i++;
      }
      elements.push(
        <ul key={key++} className="jira-list">
          {renderListItems(listItems, onTicketClick)}
        </ul>
      );
      continue;
    }

    // Ordered lists: # item, ## nested item
    if (line.match(/^#+\s/)) {
      const listItems: { level: number; content: string }[] = [];
      while (i < lines.length && lines[i].match(/^#+\s/)) {
        const match = lines[i].match(/^(#+)\s(.*)$/);
        if (match) {
          listItems.push({ level: match[1].length, content: match[2] });
        }
        i++;
      }
      elements.push(
        <ol key={key++} className="jira-list">
          {renderListItems(listItems, onTicketClick, true)}
        </ol>
      );
      continue;
    }

    // Blockquote: > text (Markdown style)
    if (line.match(/^>\s/)) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].match(/^>\s?/)) {
        const match = lines[i].match(/^>\s?(.*)$/);
        if (match) {
          quoteLines.push(match[1]);
        }
        i++;
      }
      elements.push(
        <blockquote key={key++} className="jira-quote">
          {parseWikiMarkup(quoteLines.join("\n"), onTicketClick)}
        </blockquote>
      );
      continue;
    }

    // Horizontal rule: ---- or *** or ___ (JIRA and Markdown)
    if (line.match(/^(-{4,}|\*{3,}|_{3,})$/)) {
      elements.push(<hr key={key++} className="jira-hr" />);
      i++;
      continue;
    }

    // Tables: ||header||header|| and |cell|cell|
    if (line.match(/^\|/)) {
      const tableRows: string[] = [];
      while (i < lines.length && lines[i].match(/^\|/)) {
        tableRows.push(lines[i]);
        i++;
      }
      elements.push(renderTable(tableRows, key++, onTicketClick));
      continue;
    }

    // Empty line = paragraph break
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={key++} className="jira-paragraph">
        {parseInline(line, onTicketClick)}
      </p>
    );
    i++;
  }

  return elements;
}

// Render nested list items
function renderListItems(
  items: { level: number; content: string }[],
  onTicketClick?: (key: string) => void,
  ordered = false
): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let i = 0;

  while (i < items.length) {
    const item = items[i];
    const baseLevel = item.level;

    // Collect nested items
    const nested: { level: number; content: string }[] = [];
    let j = i + 1;
    while (j < items.length && items[j].level > baseLevel) {
      nested.push({ ...items[j], level: items[j].level - baseLevel });
      j++;
    }

    result.push(
      <li key={i}>
        {parseInline(item.content, onTicketClick)}
        {nested.length > 0 && (
          ordered ? (
            <ol className="jira-list">{renderListItems(nested, onTicketClick, true)}</ol>
          ) : (
            <ul className="jira-list">{renderListItems(nested, onTicketClick, false)}</ul>
          )
        )}
      </li>
    );

    i = j;
  }

  return result;
}

// Render table from JIRA wiki markup
function renderTable(rows: string[], key: number, onTicketClick?: (key: string) => void): React.ReactNode {
  const parsedRows = rows.map((row) => {
    const isHeader = row.includes("||");
    const cells = row
      .split(isHeader ? "||" : "|")
      .filter((cell, idx, arr) => idx > 0 && idx < arr.length - 1)
      .map((cell) => cell.trim());
    return { isHeader, cells };
  });

  return (
    <table key={key} className="jira-table">
      <tbody>
        {parsedRows.map((row, rowIdx) => (
          <tr key={rowIdx}>
            {row.cells.map((cell, cellIdx) =>
              row.isHeader ? (
                <th key={cellIdx}>{parseInline(cell, onTicketClick)}</th>
              ) : (
                <td key={cellIdx}>{parseInline(cell, onTicketClick)}</td>
              )
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Parse inline elements (bold, italic, links, etc.)
function parseInline(text: string, onTicketClick?: (key: string) => void): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Links: [text](url) (Markdown style) - check first to avoid conflict with JIRA style
    const mdLinkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (mdLinkMatch) {
      const linkText = mdLinkMatch[1];
      const linkUrl = mdLinkMatch[2];

      // Check if it's a ticket key
      if (linkUrl.match(/^[A-Z][A-Z0-9]+-\d+$/)) {
        elements.push(
          <button
            key={key++}
            className="jira-ticket-link"
            onClick={() => onTicketClick?.(linkUrl)}
          >
            {linkText}
          </button>
        );
      } else {
        elements.push(
          <a key={key++} href={linkUrl} target="_blank" rel="noopener noreferrer">
            {linkText}
          </a>
        );
      }
      remaining = remaining.slice(mdLinkMatch[0].length);
      continue;
    }

    // Links: [text|url] or [url] (JIRA style)
    const linkMatch = remaining.match(/^\[([^\]|]+)(?:\|([^\]]+))?\]/);
    if (linkMatch) {
      const linkText = linkMatch[2] ? linkMatch[1] : linkMatch[1];
      const linkUrl = linkMatch[2] || linkMatch[1];

      // Check if it's a ticket key
      if (linkUrl.match(/^[A-Z][A-Z0-9]+-\d+$/)) {
        elements.push(
          <button
            key={key++}
            className="jira-ticket-link"
            onClick={() => onTicketClick?.(linkUrl)}
          >
            {linkText}
          </button>
        );
      } else {
        elements.push(
          <a key={key++} href={linkUrl} target="_blank" rel="noopener noreferrer">
            {linkText}
          </a>
        );
      }
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Bold: **text** (Markdown style - check first)
    const mdBoldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (mdBoldMatch) {
      elements.push(<strong key={key++}>{parseInline(mdBoldMatch[1], onTicketClick)}</strong>);
      remaining = remaining.slice(mdBoldMatch[0].length);
      continue;
    }

    // Bold: *text* (JIRA style)
    const boldMatch = remaining.match(/^\*([^*]+)\*/);
    if (boldMatch) {
      elements.push(<strong key={key++}>{parseInline(boldMatch[1], onTicketClick)}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: _text_
    const italicMatch = remaining.match(/^_([^_]+)_/);
    if (italicMatch) {
      elements.push(<em key={key++}>{parseInline(italicMatch[1], onTicketClick)}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Strikethrough: -text-
    const strikeMatch = remaining.match(/^-([^-]+)-/);
    if (strikeMatch) {
      elements.push(<del key={key++}>{parseInline(strikeMatch[1], onTicketClick)}</del>);
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // Underline: +text+
    const underlineMatch = remaining.match(/^\+([^+]+)\+/);
    if (underlineMatch) {
      elements.push(<u key={key++}>{parseInline(underlineMatch[1], onTicketClick)}</u>);
      remaining = remaining.slice(underlineMatch[0].length);
      continue;
    }

    // Superscript: ^text^
    const supMatch = remaining.match(/^\^([^^]+)\^/);
    if (supMatch) {
      elements.push(<sup key={key++}>{parseInline(supMatch[1], onTicketClick)}</sup>);
      remaining = remaining.slice(supMatch[0].length);
      continue;
    }

    // Subscript: ~text~
    const subMatch = remaining.match(/^~([^~]+)~/);
    if (subMatch) {
      elements.push(<sub key={key++}>{parseInline(subMatch[1], onTicketClick)}</sub>);
      remaining = remaining.slice(subMatch[0].length);
      continue;
    }

    // Monospace: {{text}} (JIRA style)
    const monoMatch = remaining.match(/^\{\{([^}]+)\}\}/);
    if (monoMatch) {
      elements.push(<code key={key++} className="jira-inline-code">{monoMatch[1]}</code>);
      remaining = remaining.slice(monoMatch[0].length);
      continue;
    }

    // Inline code: `text` (Markdown style)
    const backtickMatch = remaining.match(/^`([^`]+)`/);
    if (backtickMatch) {
      elements.push(<code key={key++} className="jira-inline-code">{backtickMatch[1]}</code>);
      remaining = remaining.slice(backtickMatch[0].length);
      continue;
    }

    // Color: {color:red}text{color}
    const colorMatch = remaining.match(/^\{color:([^}]+)\}([^{]*)\{color\}/);
    if (colorMatch) {
      elements.push(
        <span key={key++} style={{ color: colorMatch[1] }}>
          {parseInline(colorMatch[2], onTicketClick)}
        </span>
      );
      remaining = remaining.slice(colorMatch[0].length);
      continue;
    }

    // Ticket key reference (e.g., CAS-123)
    const ticketMatch = remaining.match(/^([A-Z][A-Z0-9]+-\d+)/);
    if (ticketMatch) {
      elements.push(
        <button
          key={key++}
          className="jira-ticket-link"
          onClick={() => onTicketClick?.(ticketMatch[1])}
        >
          {ticketMatch[1]}
        </button>
      );
      remaining = remaining.slice(ticketMatch[0].length);
      continue;
    }

    // Plain text - consume until next special character
    const plainMatch = remaining.match(/^[^*_\-+^~{[\]A-Z]+/);
    if (plainMatch) {
      elements.push(plainMatch[0]);
      remaining = remaining.slice(plainMatch[0].length);
      continue;
    }

    // Single character that didn't match any pattern
    elements.push(remaining[0]);
    remaining = remaining.slice(1);
  }

  return elements;
}

// Parse Atlassian Document Format (ADF)
function parseADF(doc: any, onTicketClick?: (key: string) => void): React.ReactNode[] {
  if (!doc || !doc.content) return [];

  return doc.content.map((node: any, index: number) => parseADFNode(node, index, onTicketClick));
}

function parseADFNode(node: any, key: number, onTicketClick?: (key: string) => void): React.ReactNode {
  if (!node) return null;

  switch (node.type) {
    case "paragraph":
      return (
        <p key={key} className="jira-paragraph">
          {node.content?.map((child: any, i: number) => parseADFNode(child, i, onTicketClick))}
        </p>
      );

    case "heading":
      const HeadingTag = `h${node.attrs?.level || 1}` as keyof JSX.IntrinsicElements;
      return (
        <HeadingTag key={key} className="jira-header">
          {node.content?.map((child: any, i: number) => parseADFNode(child, i, onTicketClick))}
        </HeadingTag>
      );

    case "text":
      let text: React.ReactNode = node.text || "";

      // Check for ticket keys in plain text
      if (typeof text === "string" && onTicketClick) {
        const parts = text.split(TICKET_KEY_PATTERN);
        if (parts.length > 1) {
          text = parts.map((part, i) => {
            if (part.match(/^[A-Z][A-Z0-9]+-\d+$/)) {
              return (
                <button
                  key={i}
                  className="jira-ticket-link"
                  onClick={() => onTicketClick(part)}
                >
                  {part}
                </button>
              );
            }
            return part;
          });
        }
      }

      // Apply marks (bold, italic, etc.)
      if (node.marks) {
        for (const mark of node.marks) {
          switch (mark.type) {
            case "strong":
              text = <strong key={key}>{text}</strong>;
              break;
            case "em":
              text = <em key={key}>{text}</em>;
              break;
            case "strike":
              text = <del key={key}>{text}</del>;
              break;
            case "underline":
              text = <u key={key}>{text}</u>;
              break;
            case "code":
              text = <code key={key} className="jira-inline-code">{text}</code>;
              break;
            case "link":
              const href = mark.attrs?.href || "";
              // Check if link is to a ticket
              const ticketMatch = href.match(/browse\/([A-Z][A-Z0-9]+-\d+)/);
              if (ticketMatch && onTicketClick) {
                text = (
                  <button
                    key={key}
                    className="jira-ticket-link"
                    onClick={() => onTicketClick(ticketMatch[1])}
                  >
                    {text}
                  </button>
                );
              } else {
                text = (
                  <a key={key} href={href} target="_blank" rel="noopener noreferrer">
                    {text}
                  </a>
                );
              }
              break;
            case "textColor":
              text = <span key={key} style={{ color: mark.attrs?.color }}>{text}</span>;
              break;
          }
        }
      }
      return text;

    case "hardBreak":
      return <br key={key} />;

    case "bulletList":
      return (
        <ul key={key} className="jira-list">
          {node.content?.map((child: any, i: number) => parseADFNode(child, i, onTicketClick))}
        </ul>
      );

    case "orderedList":
      return (
        <ol key={key} className="jira-list">
          {node.content?.map((child: any, i: number) => parseADFNode(child, i, onTicketClick))}
        </ol>
      );

    case "listItem":
      return (
        <li key={key}>
          {node.content?.map((child: any, i: number) => parseADFNode(child, i, onTicketClick))}
        </li>
      );

    case "codeBlock":
      return (
        <pre key={key} className="jira-code-block" data-language={node.attrs?.language}>
          <code>
            {node.content?.map((child: any) => child.text).join("") || ""}
          </code>
        </pre>
      );

    case "blockquote":
      return (
        <blockquote key={key} className="jira-quote">
          {node.content?.map((child: any, i: number) => parseADFNode(child, i, onTicketClick))}
        </blockquote>
      );

    case "rule":
      return <hr key={key} className="jira-hr" />;

    case "table":
      return (
        <table key={key} className="jira-table">
          <tbody>
            {node.content?.map((child: any, i: number) => parseADFNode(child, i, onTicketClick))}
          </tbody>
        </table>
      );

    case "tableRow":
      return (
        <tr key={key}>
          {node.content?.map((child: any, i: number) => parseADFNode(child, i, onTicketClick))}
        </tr>
      );

    case "tableHeader":
      return (
        <th key={key}>
          {node.content?.map((child: any, i: number) => parseADFNode(child, i, onTicketClick))}
        </th>
      );

    case "tableCell":
      return (
        <td key={key}>
          {node.content?.map((child: any, i: number) => parseADFNode(child, i, onTicketClick))}
        </td>
      );

    case "panel":
      return (
        <div key={key} className={`jira-panel jira-panel-${node.attrs?.panelType || "info"}`}>
          {node.content?.map((child: any, i: number) => parseADFNode(child, i, onTicketClick))}
        </div>
      );

    case "inlineCard":
    case "blockCard":
      // Smart links - check if it's a JIRA ticket
      const url = node.attrs?.url || "";
      const cardTicketMatch = url.match(/browse\/([A-Z][A-Z0-9]+-\d+)/);
      if (cardTicketMatch && onTicketClick) {
        return (
          <button
            key={key}
            className="jira-ticket-link"
            onClick={() => onTicketClick(cardTicketMatch[1])}
          >
            {cardTicketMatch[1]}
          </button>
        );
      }
      return (
        <a key={key} href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>
      );

    case "mention":
      return (
        <span key={key} className="jira-mention">
          @{node.attrs?.text || "user"}
        </span>
      );

    case "emoji":
      return <span key={key}>{node.attrs?.text || node.attrs?.shortName || ""}</span>;

    case "mediaSingle":
    case "media":
      // Media attachments - just show placeholder
      return (
        <span key={key} className="jira-media-placeholder">
          [Attachment]
        </span>
      );

    default:
      // Unknown node type - try to render children
      if (node.content) {
        return (
          <span key={key}>
            {node.content.map((child: any, i: number) => parseADFNode(child, i, onTicketClick))}
          </span>
        );
      }
      return null;
  }
}

export function JiraMarkdown({ content, onTicketClick }: JiraMarkdownProps) {
  if (!content) {
    return null;
  }

  // Check if content is ADF (Atlassian Document Format)
  if (typeof content === "object") {
    const doc = content as any;
    if (doc.type === "doc" && doc.content) {
      return <div className="jira-markdown">{parseADF(doc, onTicketClick)}</div>;
    }
    // Unknown object format
    return <div className="jira-markdown jira-paragraph">Complex content (view in JIRA)</div>;
  }

  // Parse as wiki markup
  return <div className="jira-markdown">{parseWikiMarkup(content, onTicketClick)}</div>;
}
