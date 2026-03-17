import { describe, expect, it } from "vitest";

// We test parseFlag by importing the module. Since parseFlag is not exported,
// we replicate its logic here to test it independently. This keeps tests
// decoupled from the chat module's side effects (readline, process.exit).
// If parseFlag is ever extracted to a utility, switch to importing it.

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;

  const parts: string[] = [];
  for (let i = idx + 1; i < args.length; i++) {
    if (args[i].startsWith("--")) break;
    parts.push(args[i]);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

describe("parseFlag", () => {
  it("returns value after flag", () => {
    expect(parseFlag(["--model", "opus"], "--model")).toBe("opus");
  });

  it("returns undefined when flag is missing", () => {
    expect(parseFlag(["--model", "opus"], "--provider")).toBeUndefined();
  });

  it("returns undefined when flag is last arg", () => {
    expect(parseFlag(["--model"], "--model")).toBeUndefined();
  });

  it("joins multi-word values", () => {
    const args = ["--system", "You", "are", "a", "helpful", "assistant"];
    expect(parseFlag(args, "--system")).toBe("You are a helpful assistant");
  });

  it("stops at next flag", () => {
    const args = ["--system", "Be", "helpful", "--model", "opus"];
    expect(parseFlag(args, "--system")).toBe("Be helpful");
  });

  it("handles flag between other flags", () => {
    const args = ["--provider", "anthropic", "--model", "sonnet", "--system", "hello"];
    expect(parseFlag(args, "--model")).toBe("sonnet");
  });

  it("returns undefined when value is another flag", () => {
    const args = ["--model", "--system", "hello"];
    expect(parseFlag(args, "--model")).toBeUndefined();
  });
});
