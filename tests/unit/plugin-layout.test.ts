import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function readJson(relPath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf8"));
}

describe("plugin layout", () => {
  it("marketplace.json parses and every plugin's source resolves to a matching plugin.json", () => {
    const marketplace = readJson(".claude-plugin/marketplace.json") as {
      plugins: { name: string; source: string }[];
    };
    expect(Array.isArray(marketplace.plugins)).toBe(true);
    expect(marketplace.plugins.length).toBeGreaterThan(0);

    for (const entry of marketplace.plugins) {
      expect(entry.source.startsWith("./")).toBe(true);
      const pluginDir = path.join(ROOT, entry.source);
      expect(fs.existsSync(pluginDir)).toBe(true);
      const pluginJsonPath = path.join(pluginDir, ".claude-plugin/plugin.json");
      expect(fs.existsSync(pluginJsonPath)).toBe(true);
      const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, "utf8")) as { name: string };
      expect(pluginJson.name).toBe(entry.name);
    }
  });

  it("both plugin.json version fields equal package.json version", () => {
    const pkg = readJson("package.json") as { version: string };
    const consensum = readJson("plugins/consensum/.claude-plugin/plugin.json") as { version: string };
    const reviewGate = readJson("plugins/consensum-review-gate/.claude-plugin/plugin.json") as {
      version: string;
    };
    expect(consensum.version).toBe(pkg.version);
    expect(reviewGate.version).toBe(pkg.version);
  });

  it("plugins/consensum/commands/ contains exactly the four consensum-*.md files with description frontmatter", () => {
    const commandsDir = path.join(ROOT, "plugins/consensum/commands");
    const files = fs.readdirSync(commandsDir).sort();
    expect(files).toEqual(
      [
        "consensum-loop.md",
        "consensum-pull-feedback.md",
        "consensum-pull-plan.md",
        "consensum-push-plan.md",
      ].sort(),
    );
    for (const file of files) {
      const content = fs.readFileSync(path.join(commandsDir, file), "utf8");
      expect(content.startsWith("---\n")).toBe(true);
      const frontmatter = content.slice(4, content.indexOf("\n---", 4));
      expect(frontmatter).toContain("description:");
    }
  });

  it("hooks.json registers the ExitPlanMode hook on both events, and both hook scripts exist", () => {
    const hooksDir = path.join(ROOT, "plugins/consensum-review-gate/hooks");
    const hooksJson = JSON.parse(fs.readFileSync(path.join(hooksDir, "hooks.json"), "utf8")) as {
      hooks: {
        PermissionRequest: { matcher: string; hooks: { command: string }[] }[];
        PostToolUse: { matcher: string; hooks: { command: string }[] }[];
      };
    };

    for (const event of ["PermissionRequest", "PostToolUse"] as const) {
      const entries = hooksJson.hooks[event];
      expect(entries).toHaveLength(1);
      expect(entries[0].matcher).toBe("ExitPlanMode");
      expect(entries[0].hooks).toHaveLength(1);
      expect(entries[0].hooks[0].command).toContain(
        "${CLAUDE_PLUGIN_ROOT}/hooks/consensum-exit-plan.mjs",
      );
    }

    expect(fs.existsSync(path.join(hooksDir, "consensum-exit-plan.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, "consensum-hook-core.mjs"))).toBe(true);
  });

  it("scripts/install.sh references all four commands and no stale dist path", () => {
    const installSh = fs.readFileSync(path.join(ROOT, "scripts/install.sh"), "utf8");
    for (const file of [
      "consensum-push-plan.md",
      "consensum-pull-feedback.md",
      "consensum-loop.md",
      "consensum-pull-plan.md",
    ]) {
      expect(installSh).toContain(file);
    }
    const stalePath = ["dist", "claude"].join("/");
    expect(installSh).not.toContain(stalePath);
  });

  it(".release-please-config.json extra-files include both plugin.json paths", () => {
    const config = readJson(".release-please-config.json") as {
      packages: { ".": { "extra-files": unknown[] } };
    };
    const extraFiles = config.packages["."]["extra-files"];
    const paths = extraFiles.map((f) => (typeof f === "string" ? f : (f as { path: string }).path));
    expect(paths).toContain("plugins/consensum/.claude-plugin/plugin.json");
    expect(paths).toContain("plugins/consensum-review-gate/.claude-plugin/plugin.json");
  });
});
