import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { readdir, stat } from "node:fs/promises";
import { join, basename, relative } from "node:path";

export const TargetDiscoverySchema = z.object({
  targetPath: z.string().describe("Absolute path to project root"),
  maxDepth: z.number().int().min(1).max(8).default(3),
});

export interface DiscoveryResult {
  targetDirectory: string;
  rootName: string;
  languages: string[];
  packageManagers: string[];
  iacFiles: string[];
  secretHintFiles: string[];
  hasGit: boolean;
  estimatedFileCount: number;
}

const LANGUAGE_HINTS: Record<string, string> = {
  "package.json": "node",
  "package-lock.json": "node",
  "yarn.lock": "node",
  "pnpm-lock.yaml": "node",
  "tsconfig.json": "typescript",
  "Cargo.toml": "rust",
  "go.mod": "go",
  "pyproject.toml": "python",
  "requirements.txt": "python",
  "Pipfile": "python",
  "Gemfile": "ruby",
  "pom.xml": "java",
  "build.gradle": "java",
};

const IAC_FILES = new Set([
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "main.tf",
  "variables.tf",
  "outputs.tf",
  "provider.tf",
  "ansible.yml",
  "playbook.yml",
]);

const SECRET_HINTS = [".env", ".env.local", ".env.production", "credentials.json", ".npmrc", ".pypirc"];

async function walk(dir: string, depth: number, maxDepth: number, acc: string[]): Promise<void> {
  if (depth > maxDepth) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist" || e.name.startsWith(".")) {
      if (e.name !== ".env") continue;
    }
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, depth + 1, maxDepth, acc);
    } else if (e.isFile()) {
      acc.push(full);
    }
  }
}

export async function discoverTarget(targetPath: string, maxDepth = 3): Promise<DiscoveryResult> {
  const root = join(targetPath);
  let info;
  try {
    info = await stat(root);
  } catch (cause) {
    throw new Error(`target directory not accessible: ${root}`, { cause });
  }
  if (!info.isDirectory()) {
    throw new Error(`target is not a directory: ${root}`);
  }
  const files: string[] = [];
  await walk(root, 0, maxDepth, files);

  const languages = new Set<string>();
  const packageManagers = new Set<string>();
  const iacFiles: string[] = [];
  const secretHintFiles: string[] = [];
  let hasGit = false;

  const seen = new Set<string>();
  for (const f of files) {
    const name = basename(f);
    if (seen.has(name)) continue;
    seen.add(name);
    if (name === ".git") hasGit = true;
    const lang = LANGUAGE_HINTS[name];
    if (lang) {
      languages.add(lang);
      if (lang === "node" || lang === "rust" || lang === "go" || lang === "python" || lang === "ruby" || lang === "java") {
        packageManagers.add(lang);
      }
    }
    if (IAC_FILES.has(name)) iacFiles.push(relative(root, f));
    if (SECRET_HINTS.some((h) => name === h || name.endsWith(h))) secretHintFiles.push(relative(root, f));
  }

  return {
    targetDirectory: root,
    rootName: basename(root),
    languages: Array.from(languages).sort(),
    packageManagers: Array.from(packageManagers).sort(),
    iacFiles: iacFiles.sort(),
    secretHintFiles: secretHintFiles.sort(),
    hasGit,
    estimatedFileCount: files.length,
  };
}

export const targetDiscoveryTool = tool(
  async (input) => {
    const result = await discoverTarget(input.targetPath, input.maxDepth);
    return JSON.stringify(result);
  },
  {
    name: "target_discovery",
    description: "Inspects a target directory to identify languages, package managers, IaC files, and secret-prone files. Use this before planning the scan.",
    schema: TargetDiscoverySchema,
  },
);
