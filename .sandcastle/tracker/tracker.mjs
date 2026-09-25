#!/usr/bin/env node
// Sandcastle issue tracker backed by Linear.
//
// Tasks are issues in the Glidewood project labelled `ready-for-agent` whose status
// is Backlog, Todo, or In Progress. Closing a task moves it to In Review, because a
// person still has to merge the agent's branch, and swaps `ready-for-agent` for
// `approved-by-agent` (or `ready-for-human` when the agent gave up). Either way it
// drops out of `list`.
//
//   node tracker.mjs list                        -> open tasks as JSON
//   node tracker.mjs view <LAN-N>                -> one task, as text
//   node tracker.mjs start <LAN-N>               -> move task to In Progress
//   node tracker.mjs close <LAN-N>               -> In Review + approved-by-agent
//   node tracker.mjs close <LAN-N> --needs-human -> In Review + ready-for-human
//   node tracker.mjs comment <LAN-N> < f         -> post stdin as a comment
//
// On the host it lives at .sandcastle/tracker/; main.ts mounts it into the sandbox at
// /home/agent/tracker/, outside the worktree, so it never shows up as an untracked file.
//
// Needs LINEAR_API_KEY (a personal API key, `lin_api_...`) in the environment.
// Sandcastle injects it from .sandcastle/.env; main.ts loads the same file on the host.

const API = "https://api.linear.app/graphql";

// Glidewood project and the Lane And Sons team's "In Review" status.
const PROJECT_ID =
    process.env.LINEAR_PROJECT_ID ?? "55f876a5-5ba9-4fe0-8d13-bf656972d94a";
const IN_REVIEW_STATE_ID =
    process.env.LINEAR_IN_REVIEW_STATE_ID ??
    "3ff5f5c9-efd2-4d80-88aa-bebb795dceee";
const IN_PROGRESS_STATE_ID = "44aa6de5-0886-4104-91f1-ef218726e958";
const TEAM_ID = "0cc7b678-84c5-404d-86b6-a7ae998283dd";
const LABEL = "ready-for-agent";
const APPROVED_LABEL = "approved-by-agent";
const NEEDS_HUMAN_LABEL = "ready-for-human";

function fail(message) {
    console.error(message);
    process.exit(1);
}

async function gql(query, variables) {
    const key = process.env.LINEAR_API_KEY;
    if (!key) fail("LINEAR_API_KEY is not set. Add it to .sandcastle/.env.");

    const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: key },
        body: JSON.stringify({ query, variables }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || json === null || json.errors) {
        fail(
            `Linear request failed (HTTP ${response.status}): ` +
                JSON.stringify(json?.errors ?? json),
        );
    }

    return json.data;
}

// Priority 1 (Urgent) to 4 (Low) first, then 0 (No priority), then oldest number.
function byPriorityThenNumber(a, b) {
    const rank = (p) => (p === 0 ? 5 : p);
    return rank(a.priority) - rank(b.priority) || a.number - b.number;
}

async function list() {
    const data = await gql(
        `query Open($project: ID!, $label: String!) {
            issues(first: 100, filter: {
                project: { id: { eq: $project } }
                labels: { name: { eq: $label } }
                state: { type: { in: ["backlog", "unstarted", "started"] }, name: { neq: "In Review" } }
            }) {
                nodes {
                    identifier number title description priority
                    state { name }
                    labels { nodes { name } }
                    inverseRelations { nodes { type issue { identifier state { type name } } } }
                }
            }
        }`,
        { project: PROJECT_ID, label: LABEL },
    );

    const open = data.issues.nodes
        .sort(byPriorityThenNumber)
        .map((issue) => ({
            id: issue.identifier,
            title: issue.title,
            status: issue.state.name,
            priority: issue.priority,
            labels: issue.labels.nodes.map((l) => l.name),
            // Issues that block this one and are not finished yet. In Review counts
            // as finished: its commits are already on the agent branch this run builds on.
            blockedBy: issue.inverseRelations.nodes
                .filter(
                    (r) =>
                        r.type === "blocks" &&
                        !["completed", "canceled"].includes(
                            r.issue.state.type,
                        ) &&
                        r.issue.state.name !== "In Review",
                )
                .map((r) => r.issue.identifier),
            body: issue.description ?? "",
        }));
    console.log(JSON.stringify(open, null, 2));
}

async function view(id) {
    const data = await gql(
        `query View($id: String!) {
            issue(id: $id) {
                identifier title description url
                state { name }
                labels { nodes { name } }
                comments(first: 50) { nodes { createdAt body user { name } } }
            }
        }`,
        { id },
    );
    const issue = data.issue;
    if (issue === null) fail(`No issue ${id} in Linear`);

    const comments = issue.comments.nodes
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(
            (c) =>
                `--- ${c.user?.name ?? "unknown"}, ${c.createdAt}\n${c.body}`,
        );
    console.log(
        [
            `${issue.identifier}: ${issue.title}`,
            `Status: ${issue.state.name}`,
            `Labels: ${issue.labels.nodes.map((l) => l.name).join(", ")}`,
            issue.url,
            "",
            issue.description ?? "(no description)",
            "",
            comments.length > 0
                ? `Comments:\n${comments.join("\n\n")}`
                : "No comments.",
        ].join("\n"),
    );
}

async function labelId(name) {
    const data = await gql(
        `query Label($name: String!, $team: ID!) {
            issueLabels(first: 1, filter: { name: { eq: $name }, team: { id: { eq: $team } } }) {
                nodes { id }
            }
        }`,
        { name, team: TEAM_ID },
    );
    const label = data.issueLabels.nodes[0];
    if (label === undefined) fail(`No label named ${name} on the team`);
    return label.id;
}

async function setState(id, state, labels) {
    const data = await gql(
        `mutation Move($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
                success
                issue { identifier state { name } labels { nodes { name } } }
            }
        }`,
        { id, input: { stateId: state, ...labels } },
    );
    if (!data.issueUpdate.success) fail(`Linear refused to update ${id}`);
    return data.issueUpdate.issue;
}

async function start(id) {
    const issue = await setState(id, IN_PROGRESS_STATE_ID, {});
    console.error(`Started: ${issue.identifier} is now ${issue.state.name}`);
}

async function close(id, needsHuman) {
    const [ready, outcome] = await Promise.all([
        labelId(LABEL),
        labelId(needsHuman ? NEEDS_HUMAN_LABEL : APPROVED_LABEL),
    ]);
    const issue = await setState(id, IN_REVIEW_STATE_ID, {
        removedLabelIds: [ready],
        addedLabelIds: [outcome],
    });
    const labels = issue.labels.nodes.map((l) => l.name).join(", ");
    console.error(
        `Closed: ${issue.identifier} is now ${issue.state.name} [${labels}]`,
    );
}

async function comment(id) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8").trim();
    if (body === "") fail("Comment body is empty. Pipe it on stdin.");

    const data = await gql(
        `mutation Comment($id: String!, $body: String!) {
            commentCreate(input: { issueId: $id, body: $body }) { success }
        }`,
        { id, body },
    );
    if (!data.commentCreate.success) fail(`Linear refused the comment on ${id}`);
    console.error(`Commented on ${id}`);
}

const [command, arg, flag] = process.argv.slice(2);
const needsId = ["view", "start", "close", "comment"].includes(command);
if (needsId && !/^[A-Z]+-\d+$/.test(arg ?? "")) {
    fail(`${command} needs an issue identifier, for example LAN-475`);
}

switch (command) {
    case "list":
        await list();
        break;
    case "view":
        await view(arg);
        break;
    case "start":
        await start(arg);
        break;
    case "close":
        if (flag !== undefined && flag !== "--needs-human") {
            fail(`Unknown flag ${flag}. The only flag is --needs-human.`);
        }
        await close(arg, flag === "--needs-human");
        break;
    case "comment":
        await comment(arg);
        break;
    default:
        fail(
            "Usage: tracker.mjs list | view <ID> | start <ID> | close <ID> [--needs-human] | comment <ID> < body",
        );
}
