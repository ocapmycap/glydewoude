# Context

<!-- Use !`command` to pull in dynamic context. Commands run inside the sandbox. -->

Open tasks — Linear issues in the Glidewood project with status Todo, as JSON:

!`curl -s https://api.linear.app/graphql -H "Authorization: $LINEAR_API_KEY" -H 'Content-Type: application/json' -d '{"query":"{ issues(first: 100, filter: {project: {id: {eq: \"55f876a5-5ba9-4fe0-8d13-bf656972d94a\"}}, state: {type: {eq: \"unstarted\"}}}) { nodes { identifier title description } } }"}' | jq -e '[.data.issues.nodes[] | {id: .identifier, title, body: (.description // "")}]'`

# Task

Pick one task from the list above and complete it, following the repository's `CLAUDE.md`.

To read a task in full, replace `LAN-123` with its id:

```sh
jq -n --arg id LAN-123 '{query: "query($id: String!) { issue(id: $id) { identifier title description state { name } comments { nodes { body } } } }", variables: {id: $id}}' \
  | curl -s https://api.linear.app/graphql -H "Authorization: $LINEAR_API_KEY" -H 'Content-Type: application/json' -d @- | jq .
```

When the task is done and `npm run verify` passes, close it by moving it to Done:

```sh
jq -n --arg id LAN-123 '{query: "mutation($id: String!) { issueUpdate(id: $id, input: {stateId: \"849f41f8-984d-4c8d-a1ac-62a9ebc950ea\"}) { success issue { identifier state { name } } } }", variables: {id: $id}}' \
  | curl -s https://api.linear.app/graphql -H "Authorization: $LINEAR_API_KEY" -H 'Content-Type: application/json' -d @- | jq .
```

# Done

When the task is complete, output <promise>COMPLETE</promise> to signal early termination.
