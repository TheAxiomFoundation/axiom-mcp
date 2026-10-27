import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EVAL_MODEL, type PromptDriver, type RunOutcome } from "./eval-driver.js";
import { MCP_SERVER_NAME, parseCliStream } from "./eval-cli-stream.js";

/**
 * Reaches a model through the Claude Code CLI, which needs no Anthropic API
 * key: `claude` signs in on its own login. That is the whole point of this
 * driver. It also makes the eval more faithful in one way, because the prompt
 * is read by a real MCP client over stdio rather than by a loop written here.
 *
 * Each run is isolated on purpose, so a result does not depend on whose
 * machine it ran on:
 *
 *   --strict-mcp-config   ignore every MCP server but ours
 *   --tools ""            no built-in tools, so the only way to an answer is
 *                         the Axiom server — 29 tools and nothing else
 *   --setting-sources ""  no user, project or local settings, so no hooks
 *   --system-prompt       a fixed, neutral prompt in place of the default one
 *                         and whatever CLAUDE.md files are lying around
 *   an empty cwd          nothing on disk for the run to pick up
 *
 * The CLI of this writing has no turn cap, so a run that loops instead of
 * answering is bounded by wall clock rather than by a count of model calls.
 */

const SERVER_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const TSX_BIN = fileURLToPath(
  new URL("../node_modules/.bin/tsx", import.meta.url)
);

const TIMEOUT_MS = Number(process.env.AXIOM_EVAL_TIMEOUT_MS || 10 * 60 * 1000);

/**
 * Deliberately says nothing about Axiom. The prompt under test is what has to
 * do that work, so anything taught here would mask a prompt that does not.
 */
const SYSTEM_PROMPT =
  "You are an assistant with tools. Use them to answer the user's question, " +
  "then give your answer in plain prose.";

export interface CliDriverOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs?: string;
  readonly model?: string;
}

export function createCliDriver(options: CliDriverOptions): PromptDriver {
  const model = options.model ?? EVAL_MODEL;
  const claudeBin = process.env.CLAUDE_BIN || "claude";
  let workDir: string | undefined;
  let configPath: string | undefined;

  return {
    name: "cli",
    billing: `the ${claudeBin} CLI login`,

    async run(userMessage: string): Promise<RunOutcome> {
      if (!workDir || !configPath) {
        workDir = await mkdtemp(join(tmpdir(), "axiom-prompt-eval-"));
        configPath = join(workDir, "mcp.json");
        await writeFile(configPath, mcpConfig(options), "utf8");
      }
      const args = [
        "--print",
        userMessage,
        "--output-format",
        "stream-json",
        // stream-json refuses to print without it.
        "--verbose",
        "--mcp-config",
        configPath,
        "--strict-mcp-config",
        "--tools",
        "",
        "--allowedTools",
        `mcp__${MCP_SERVER_NAME}`,
        // Nothing is watching to answer a permission prompt, so anything
        // that would ask is denied and reported rather than left to hang.
        "--permission-prompts",
        "none",
        "--setting-sources",
        "",
        "--system-prompt",
        SYSTEM_PROMPT,
        "--model",
        model,
        "--no-session-persistence"
      ];
      const parsed = parseCliStream(await runClaude(claudeBin, args, workDir));
      return {
        ok: parsed.ok,
        reason: parsed.reason,
        text: parsed.text,
        toolsCalled: parsed.toolsCalled,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        iterations: parsed.turns,
        costUsd: parsed.costUsd
      };
    },

    async close(): Promise<void> {
      if (workDir) await rm(workDir, { recursive: true, force: true });
      workDir = undefined;
      configPath = undefined;
    }
  };
}

/** The Axiom server, run from source so a stale `dist` cannot be graded. */
function mcpConfig(options: CliDriverOptions): string {
  return JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: process.execPath,
        args: [TSX_BIN, SERVER_ENTRY],
        env: {
          AXIOM_API_BASE_URL: options.baseUrl,
          AXIOM_API_KEY: options.apiKey,
          ...(options.timeoutMs
            ? { AXIOM_API_TIMEOUT_MS: options.timeoutMs }
            : {})
        }
      }
    }
  });
}

/** Collects the CLI's stdout lines, or explains what went wrong instead. */
async function runClaude(
  bin: string,
  args: string[],
  cwd: string
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env: childEnv(), stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `${bin} did not finish within ${TIMEOUT_MS}ms. Raise ` +
            "AXIOM_EVAL_TIMEOUT_MS, or look at whether the prompt sends the " +
            "agent in a loop."
        )
      );
    }, TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          `could not run "${bin}": ${error.message}. Install the Claude ` +
            "Code CLI, or point CLAUDE_BIN at it."
        )
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // A nonzero exit still prints a result event most of the time, and the
      // parser says more about why than the exit code does. Only a run with
      // nothing at all to read is raised here.
      if (stdout.trim() === "") {
        reject(
          new Error(
            `${bin} exited ${code ?? "unknown"} and printed nothing.\n${stderr.trim()}`
          )
        );
        return;
      }
      resolve(stdout.split("\n"));
    });
  });
}

/**
 * ANTHROPIC_API_KEY is removed on purpose. The CLI switches to API billing
 * when it sees one, and this driver exists to run on the CLI's own login. Use
 * the sdk driver to spend an API key deliberately.
 *
 * The output ceiling is raised for a second reason. A runtime package runs to
 * tens of kilobytes, and past the ceiling the CLI writes the result to a file
 * and hands the model the path. This driver gives the model the Axiom tools
 * and nothing else, so it has no way to open that file: it answered one case
 * with `returned about 60 KB, which went to a file I had no way to open`, and
 * the eval scored a starved model as a failed prompt.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  env.MAX_MCP_OUTPUT_TOKENS =
    process.env.MAX_MCP_OUTPUT_TOKENS || "50000";
  return env;
}
