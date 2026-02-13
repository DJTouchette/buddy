/**
 * Convert JIRA ADF (Atlassian Document Format) to markdown.
 * Pure function with no React dependencies - can be used by both frontend and backend.
 */
export function adfToMarkdown(adf: any): string {
  if (!adf || typeof adf === "string") return adf || "";
  if (!adf.content) return "";

  const extractText = (node: any, listDepth = 0): string => {
    if (node.type === "text") {
      let text = node.text || "";
      // Apply marks (bold, italic, code, etc.)
      if (node.marks) {
        for (const mark of node.marks) {
          if (mark.type === "strong") text = `**${text}**`;
          else if (mark.type === "em") text = `*${text}*`;
          else if (mark.type === "code") text = `\`${text}\``;
          else if (mark.type === "strike") text = `~~${text}~~`;
          else if (mark.type === "link") text = `[${text}](${mark.attrs?.href || ""})`;
        }
      }
      return text;
    }
    if (node.type === "hardBreak") return "\n";
    if (node.type === "paragraph") {
      const text = (node.content || []).map((n: any) => extractText(n, listDepth)).join("");
      return text + "\n\n";
    }
    if (node.type === "heading") {
      const level = node.attrs?.level || 1;
      const text = (node.content || []).map((n: any) => extractText(n, listDepth)).join("");
      return "#".repeat(level) + " " + text + "\n\n";
    }
    if (node.type === "bulletList") {
      return (node.content || []).map((n: any) => extractText(n, listDepth)).join("") + "\n";
    }
    if (node.type === "orderedList") {
      return (
        (node.content || [])
          .map((n: any, i: number) => extractText({ ...n, _orderedIndex: i + 1 }, listDepth))
          .join("") + "\n"
      );
    }
    if (node.type === "listItem") {
      const indent = "  ".repeat(listDepth);
      const bullet = node._orderedIndex ? `${node._orderedIndex}.` : "*";
      const text = (node.content || [])
        .map((n: any) => extractText(n, listDepth + 1))
        .join("")
        .trim();
      return `${indent}${bullet} ${text}\n`;
    }
    if (node.type === "codeBlock") {
      const lang = node.attrs?.language || "";
      const text = (node.content || []).map((n: any) => extractText(n, listDepth)).join("");
      return "```" + lang + "\n" + text + "```\n\n";
    }
    if (node.type === "blockquote") {
      const text = (node.content || []).map((n: any) => extractText(n, listDepth)).join("");
      return (
        text
          .split("\n")
          .map((line: string) => (line ? `> ${line}` : ">"))
          .join("\n") + "\n"
      );
    }
    if (node.type === "rule") {
      return "---\n\n";
    }
    if (node.content) {
      return node.content.map((n: any) => extractText(n, listDepth)).join("");
    }
    return "";
  };

  return adf.content
    .map((n: any) => extractText(n))
    .join("")
    .trim();
}
