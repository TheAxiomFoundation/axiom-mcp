import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const packageSpec =
  process.env.AXIOM_MCP_GITHUB_INSTALL_SPEC ||
  "github:TheAxiomFoundation/axiom-mcp";
const keepTemp = process.env.AXIOM_MCP_KEEP_SMOKE_DIR === "true";
const dir = mkdtempSync(join(tmpdir(), "axiom-mcp-github-install-"));

try {
  run("npm", ["init", "-y"], dir, "pipe");
  run("npm", ["install", packageSpec, "--foreground-scripts"], dir);

  const packageRoot = join(dir, "node_modules", "@axiom-foundation", "mcp");
  const packageJsonPath = join(packageRoot, "package.json");
  const distIndexPath = join(packageRoot, "dist", "index.js");
  const binPath = join(
    dir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "axiom-mcp.cmd" : "axiom-mcp"
  );

  if (!existsSync(packageJsonPath)) {
    throw new Error(`Installed package.json is missing at ${packageJsonPath}`);
  }
  if (!existsSync(distIndexPath)) {
    throw new Error(`Installed dist/index.js is missing at ${distIndexPath}`);
  }
  if (!existsSync(binPath)) {
    throw new Error(`Installed axiom-mcp bin is missing at ${binPath}`);
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    name?: string;
    version?: string;
    bin?: Record<string, string>;
  };
  if (packageJson.name !== "@axiom-foundation/mcp") {
    throw new Error(`Unexpected installed package name: ${packageJson.name}`);
  }
  if (packageJson.bin?.["axiom-mcp"] !== "dist/index.js") {
    throw new Error(`Unexpected bin mapping: ${JSON.stringify(packageJson.bin)}`);
  }

  console.log(
    `GitHub install smoke passed for ${packageSpec}: ${packageJson.name}@${packageJson.version}`
  );
} finally {
  if (keepTemp) {
    console.log(`Kept smoke directory: ${dir}`);
  } else {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(
  command: string,
  args: string[],
  cwd: string,
  stdio: "inherit" | "pipe" = "inherit"
) {
  const result = spawnSync(command, args, {
    cwd,
    stdio,
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}`);
  }
}
