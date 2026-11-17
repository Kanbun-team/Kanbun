// A deliberately small, safe Markdown-to-HTML renderer.
//
// Safety model: the raw input is HTML-escaped FIRST, so user text can never
// introduce tags or attributes. The only HTML in the output is the fixed set
// of tags this module emits. Links are restricted to http(s)/mailto. There is
// no need for a sanitizer because no user-controlled HTML ever reaches output.
//
// Supported: headings (#, ##, ###), unordered (-, *) and ordered (1.) lists,
// **bold**, *italic*/_italic_, `code`, ~~strikethrough~~, [text](url), and
// single line breaks within a paragraph.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emphasis(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\s][^_]*?)_/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

// Placeholder delimiter. NUL is stripped from input, so it cannot be forged.
const PH = "\u0000";

function inline(raw: string): string {
  const slots: string[] = [];
  const stash = (html: string) => `${PH}${slots.push(html) - 1}${PH}`;

  let out = escapeHtml(raw.replace(/\u0000/g, ""));

  // Code spans first, so nothing inside them is formatted.
  out = out.replace(/`([^`]+)`/g, (_m, code: string) =>
    stash(
      `<code class="px-1 py-0.5 rounded bg-ink/5 text-[0.85em]">${code}</code>`
    )
  );

  // Links: [text](http(s)://… | mailto:…). The url is already escaped, so it
  // cannot contain quotes that break out of the attribute. The whole tag is
  // stashed so emphasis rules never touch the url or the attributes.
  out = out.replace(
    /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g,
    (_m, text: string, url: string) =>
      stash(
        `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-accent underline">${emphasis(text)}</a>`
      )
  );

  out = emphasis(out);

  // Restore until stable: link text may itself contain a stashed code span.
  const slot = new RegExp(`${PH}(\\d+)${PH}`, "g");
  while (slot.test(out)) {
    out = out.replace(slot, (_m, i: string) => slots[Number(i)]);
  }
  return out;
}

export function renderMarkdownToHtml(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let para: string[] = [];
  let i = 0;

  const flushPara = () => {
    if (para.length) {
      blocks.push(`<p>${para.map(inline).join("<br>")}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      flushPara();
      i += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      const level = heading[1].length + 2; // # -> h3
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        i += 1;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    para.push(line);
    i += 1;
  }

  flushPara();
  return blocks.join("");
}
