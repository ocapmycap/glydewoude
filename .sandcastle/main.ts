import { execFileSync } from "node:child_process";
import { run, claudeCode, type AgentStreamEvent } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

// Run from the repo root with:
//   npx tsx .sandcastle/main.ts
//
// @ai-hero/sandcastle is not a dependency of this repo; Node finds the copy in
// ~/node_modules by searching upward. Run from the root: promptFile, the mounts and
// the tracker path are all relative to it.

// The tracker needs LINEAR_API_KEY on the host too, for the check below. Sandcastle
// reads .sandcastle/.env for the sandbox itself; this loads it for this process.
process.loadEnvFile(".sandcastle/.env");

const BASE_BRANCH = "devel";
// Runs stack onto the existing night-run branch rather than a fresh one, so new
// tickets build on its unmerged work. BASE_BRANCH only matters if it is deleted.
const BRANCH = "agent/glidewood-20260927-0250";

// One Linear issue per iteration. A run stops early once the list is empty. An
// iteration that dies before closing its issue leaves it open for the next one.
const MAX_ITERATIONS = 20;

// Nothing to do is worth knowing before a container starts.
const open = JSON.parse(
  execFileSync("node", [".sandcastle/tracker/tracker.mjs", "list"], {
    encoding: "utf8",
  }),
);
if (open.length === 0) {
  console.log(
    "No open Glidewood issues are labelled ready-for-agent in Linear.",
  );
  process.exit(0);
}

console.log(`Branch:      ${BRANCH} (from ${BASE_BRANCH})`);
console.log(`Open issues: ${open.map((t: { id: string }) => t.id).join(", ")}`);

// A short status line every 5 minutes, so you do not have to tail the log. The
// current issue is the last one the agent ran `tracker.mjs view` on.
const STATUS_EVERY_MS = 5 * 60 * 1000;
const startedAt = Date.now();
const status = {
  issue: "choosing an issue",
  iteration: 1,
  lastStep: "none yet",
  closed: [] as string[],
};

function onAgentStreamEvent(event: AgentStreamEvent) {
  status.iteration = event.iteration;
  // Sandcastle surfaces only Bash, Agent, WebSearch, and WebFetch calls, not reads or edits.
  if (event.type !== "toolCall") return;
  const args = event.formattedArgs.replace(/\s+/g, " ");
  status.lastStep = `${event.name}: ${args.length > 70 ? `${args.slice(0, 70)}…` : args}`;
  const tracker =
    /tracker\.mjs (view|close) ([A-Z]+-\d+)( --needs-human)?/.exec(
      event.formattedArgs,
    );
  if (tracker === null) return;
  const [, command, id, needsHuman] = tracker;
  if (command === "view") status.issue = id;
  const entry = needsHuman ? `${id} (needs human)` : id;
  if (command === "close" && !status.closed.includes(entry))
    status.closed.push(entry);
}

function elapsed(): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h${m}m${s}s` : `${m}m${s}s`;
}

// unref: the timer never keeps the process alive after the run ends.
setInterval(() => {
  const done = status.closed.length > 0 ? status.closed.join(", ") : "none";
  console.log(
    `\n⏱️  ${elapsed()} · iteration ${status.iteration}/${MAX_ITERATIONS}\n` +
      `   Working on ${status.issue}\n   Last step: ${status.lastStep}\n` +
      `   Closed this run: ${done}`,
  );
}, STATUS_EVERY_MS).unref();

// Passing `logging` (to attach onAgentStreamEvent) means naming the log file here.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = `.sandcastle/logs/${BRANCH.replace("/", "-")}-${stamp}.log`;

// A macOS banner and sound, so the end of a long run is noticed even when the
// terminal is hidden. A failure here must not hide the summary, so errors are ignored.
function notify(title: string, message: string, sound: string) {
  try {
    execFileSync("osascript", [
      "-e",
      `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)} sound name ${JSON.stringify(sound)}`,
    ]);
  } catch {
    // Not on macOS, or notifications are off.
  }
}

function printSummary(lines: string[]) {
  const bar = "🏁".repeat(20);
  console.log(`\n${bar}\n${lines.join("\n")}\n${bar}\n`);
}

let result: Awaited<ReturnType<typeof run>>;
try {
  result = await run({
    agent: claudeCode("claude-opus-5-5"),

    sandbox: docker({
      // The worktree holds only what is committed on BASE_BRANCH. Mount the tracker,
      // skills, subagents and deny rules from the host, read-only, so an edit to any
      // of them takes effect on the next run without a commit or an image rebuild.
      // Every sandboxPath is outside the worktree, so none of them can show up there
      // as an untracked file or be committed by accident.
      mounts: [
        {
          hostPath: ".sandcastle/tracker",
          sandboxPath: "/home/agent/tracker",
          readonly: true,
        },
        {
          hostPath: ".claude/skills",
          sandboxPath: "/home/agent/.claude/skills",
          readonly: true,
        },
        {
          hostPath: ".sandcastle/claude-home/agents",
          sandboxPath: "/home/agent/.claude/agents",
          readonly: true,
        },
        {
          hostPath: ".sandcastle/claude-home/settings.json",
          sandboxPath: "/home/agent/.claude/settings.json",
          readonly: true,
        },
      ],
    }),

    promptFile: "./.sandcastle/prompt.md",

    logging: {
      type: "file",
      path: logPath,
      onAgentStreamEvent,
    },

    // A named branch persists after the run and is reused if you run again, so a
    // crashed run continues where it stopped. Nothing reaches devel until you
    // merge it yourself.
    branchStrategy: { type: "branch", branch: BRANCH, baseBranch: BASE_BRANCH },

    maxIterations: MAX_ITERATIONS,

    // Subagents can work for a long time without the orchestrator printing anything.
    idleTimeoutSeconds: 1800,

    hooks: {
      sandbox: {
        // A fresh worktree has no node_modules, and the host's copy would not run
        // here anyway: esbuild and rollup ship per-platform binaries, and the
        // sandbox is Linux. Installing first also means a network failure stops the
        // run here instead of inside the agent's first `npm run verify`.
        onSandboxReady: [{ command: "npm ci", timeoutMs: 600_000 }],
      },
    },
  });
} catch (error) {
  printSummary([
    `❌  SANDCASTLE FAILED · ${elapsed()}`,
    `   ${error instanceof Error ? error.message : String(error)}`,
    `   Closed before the failure: ${status.closed.join(", ") || "none"}`,
    `   Log: ${logPath}`,
  ]);
  notify("Sandcastle failed", `After ${elapsed()}. See the terminal.`, "Basso");
  process.exit(1);
}

const reason =
  result.completionSignal !== undefined
    ? "agent finished: no unblocked issues left"
    : `hit the ${MAX_ITERATIONS}-iteration limit: issues may remain`;
printSummary([
  `✅  SANDCASTLE FINISHED · ${elapsed()}`,
  `   ${result.iterations.length} of ${MAX_ITERATIONS} iterations · ${reason}`,
  `   Closed: ${status.closed.join(", ") || "none"}`,
  `   Commits: ${result.commits.length} on ${BRANCH}`,
  `   Log: ${logPath}`,
]);
notify(
  "Sandcastle finished",
  `${status.closed.length} issue(s) closed in ${elapsed()}.`,
  "Glass",
);
