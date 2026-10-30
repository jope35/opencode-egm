export function parseFrontmatter(text: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const open = /^---[ \t]*\r?\n/.exec(source);
  if (!open) return { data: {}, body: source };

  const rest = source.slice(open[0].length);
  const close = /^---[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!close) return { data: {}, body: source };

  const yaml = rest.slice(0, close.index);
  const body = rest.slice(close.index + close[0].length);
  const parsed = yaml.trim() === "" ? {} : parseYaml(yaml);
  if (parsed === null) return { data: {}, body };
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("frontmatter must be a YAML mapping");
  }

  const data = parsed as Record<string, unknown>;
  for (const key of ["name", "description"] as const) {
    if (key in data && typeof data[key] !== "string") {
      throw new TypeError(`frontmatter "${key}" must be a string`);
    }
  }
  return { data, body };
}

// Bun.YAML.parse is the primary parser. It rejects a bare value that contains
// ": ", which upstream frontmatter occasionally carries.
function parseYaml(yaml: string): unknown {
  try {
    return Bun.YAML.parse(yaml);
  } catch {
    const data: Record<string, unknown> = {};
    for (const line of yaml.split(/\r?\n/)) {
      const match = /^([A-Za-z0-9_-]+):\s+(.*)$/.exec(line);
      if (!match) continue;
      const [, key, raw] = match;
      data[key] = raw === "true" ? true : raw === "false" ? false : raw;
    }
    return data;
  }
}
