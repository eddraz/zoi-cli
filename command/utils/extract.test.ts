import { describe, it as test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { extractBashCommands } from "./extract.ts";

describe("extractBashCommands", () => {
  test("extracts single bash command block", () => {
    const text = "```bash\necho 'hello world'\n```";
    const result = extractBashCommands(text);
    expect(result).toEqual(["echo 'hello world'"]);
  });

  test("extracts multiple code blocks with different shell tags", () => {
    const text = `
Here is step 1:
\`\`\`bash
echo "step 1"
\`\`\`

And step 2:
\`\`\`sh
ls -la
\`\`\`

And step 3:
\`\`\`shell
pwd
\`\`\`

And step 4 (no language tag):
\`\`\`
git status
\`\`\`
`;
    const result = extractBashCommands(text);
    expect(result).toEqual([
      'echo "step 1"',
      "ls -la",
      "pwd",
      "git status",
    ]);
  });

  test("returns empty array when no valid bash blocks are present", () => {
    const text = "This is a simple text with no code blocks.";
    const result = extractBashCommands(text);
    expect(result).toEqual([]);
  });

  test("ignores non-shell code blocks such as python", () => {
    const text = `
\`\`\`python
print("hello")
\`\`\`
\`\`\`bash
echo "hello"
\`\`\`
`;
    const result = extractBashCommands(text);
    expect(result).toEqual(['echo "hello"']);
  });

  test("trims leading and trailing whitespace inside code blocks", () => {
    const text = "```bash\n\n   echo 'trimmed'   \n\n```";
    const result = extractBashCommands(text);
    expect(result).toEqual(["echo 'trimmed'"]);
  });
});
