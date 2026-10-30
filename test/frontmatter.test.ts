import { describe, expect, test } from "bun:test";
import { parseFrontmatter } from "../src/frontmatter.ts";

describe("parseFrontmatter", () => {
  test("parses full frontmatter and strips the fence", () => {
    const input = [
      "---",
      "name: egm-review",
      "description: Review a design document",
      "disable-model-invocation: true",
      "---",
      "# Body",
      "",
      "Text.",
      "",
    ].join("\n");
    const { data, body } = parseFrontmatter(input);
    expect(data).toEqual({
      name: "egm-review",
      description: "Review a design document",
      "disable-model-invocation": true,
    });
    expect(body).toBe("# Body\n\nText.\n");
  });

  test("joins a folded description block", () => {
    const input = [
      "---",
      "name: egm-draft",
      "description: >-",
      "  Write the design document",
      "  and check it.",
      "---",
      "Body.",
    ].join("\n");
    const { data } = parseFrontmatter(input);
    expect(data.description).toBe("Write the design document and check it.");
  });

  test("keeps a colon inside a description", () => {
    const input = ["---", "description: Use this: now", "---", "Body."].join("\n");
    const { data } = parseFrontmatter(input);
    expect(data.description).toBe("Use this: now");
  });

  test("preserves CRLF in the body", () => {
    const input = "---\r\nname: egm-drift-report\r\n---\r\nLine one\r\nLine two\r\n";
    const { data, body } = parseFrontmatter(input);
    expect(data.name).toBe("egm-drift-report");
    expect(body).toBe("Line one\r\nLine two\r\n");
  });

  test("handles input without frontmatter", () => {
    const input = "# Just a body\n";
    const { data, body } = parseFrontmatter(input);
    expect(data).toEqual({});
    expect(body).toBe(input);
  });

  test("handles an empty fence", () => {
    const input = "---\n---\nBody.";
    const { data, body } = parseFrontmatter(input);
    expect(data).toEqual({});
    expect(body).toBe("Body.");
  });

  test("ignores a UTF-8 BOM", () => {
    const input = "\uFEFF---\nname: egm-resolve\n---\nBody.";
    const { data, body } = parseFrontmatter(input);
    expect(data.name).toBe("egm-resolve");
    expect(body).toBe("Body.");
  });
});
