export interface Frontmatter {
  readonly data: Record<string, unknown>;
  readonly body: string;
}

function parseYaml(yaml: string, source: string): unknown {
  const parser = Bun.YAML?.parse;
  if (typeof parser !== "function") {
    throw new Error("Bun.YAML is unavailable; opencode-egm needs a Bun build with YAML support");
  }
  try {
    return parser(yaml);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid YAML in ${source}: ${message}`, { cause: error });
  }
}

export function parseFrontmatter(text: string, source = "frontmatter"): Frontmatter {
  const input = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const open = /^---[ \t]*\r?\n/.exec(input);
  if (!open) return { data: {}, body: input };

  const rest = input.slice(open[0].length);
  const close = /^---[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!close) return { data: {}, body: input };

  const yaml = rest.slice(0, close.index);
  const body = rest.slice(close.index + close[0].length);
  const parsed = yaml.trim() === "" ? {} : parseYaml(yaml, source);
  if (parsed === null || parsed === undefined) return { data: {}, body };
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`frontmatter in ${source} must be a YAML mapping`);
  }

  const data = parsed as Record<string, unknown>;
  for (const key of ["name", "description"] as const) {
    if (key in data && typeof data[key] !== "string") {
      throw new TypeError(`frontmatter "${key}" in ${source} must be a string`);
    }
  }
  return { data, body };
}
