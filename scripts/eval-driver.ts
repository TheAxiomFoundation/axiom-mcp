/**
 * What the prompt eval needs from a model, and nothing more.
 *
 * The cases in `eval-prompts.ts` grade a run through `RunOutcome` alone. That
 * makes the two ways of reaching a model interchangeable: the Anthropic API
 * with a key (`eval-driver-sdk.ts`), or the Claude Code CLI on its own login
 * with no key at all (`eval-driver-cli.ts`). The prompt text and every grader
 * stay identical across both, so a result means the same thing either way.
 */

/** The model both drivers ask for, so a run is comparable across them. */
export const EVAL_MODEL = "claude-opus-5-5";

export interface RunOutcome {
  /** False when the run never produced an answer to grade. */
  readonly ok: boolean;
  /** Why there is no answer. Empty when `ok`. */
  readonly reason: string;
  /** The model's final text, which the graders search. */
  readonly text: string;
  /**
   * Tool names as the server declares them, with any client-side prefix
   * removed, so `toolCheck` asks about `list_variables` and not
   * `mcp__axiom__list_variables`.
   */
  readonly toolsCalled: Set<string>;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Model calls the run took. */
  readonly iterations: number;
  /** What the run cost, by the driver's own reckoning. */
  readonly costUsd: number;
}

export interface PromptDriver {
  /** The value `AXIOM_EVAL_DRIVER` takes to select this driver. */
  readonly name: string;
  /** What the report says the run was billed to. */
  readonly billing: string;
  /** Runs one user message to an answer, or explains why there is none. */
  run(userMessage: string): Promise<RunOutcome>;
  close(): Promise<void>;
}
