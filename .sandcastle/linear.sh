#!/usr/bin/env bash
# Linear commands for unattended Sandcastle runs. Talks to Linear's GraphQL API
# with curl and jq so the sandbox image needs no tracker CLI.
#
#   linear.sh list                 open Glidewood issues in Todo, as JSON
#   linear.sh view    LAN-123      one issue with its comments
#   linear.sh comment LAN-123 TEXT add a comment (Markdown)
#   linear.sh done    LAN-123      move to Done
#   linear.sh review  LAN-123      move to In Review (finished, needs a human look)
#   linear.sh park    LAN-123      move to Backlog (blocked; the comment says why)
#
# Needs LINEAR_API_KEY in the environment (.sandcastle/.env).

set -euo pipefail

# Glidewood project and Lane And Sons workflow states. If a state is deleted
# and recreated in Linear its ID changes; update it here.
PROJECT_ID=55f876a5-5ba9-4fe0-8d13-bf656972d94a
STATE_DONE=849f41f8-984d-4c8d-a1ac-62a9ebc950ea
STATE_IN_REVIEW=3ff5f5c9-efd2-4d80-88aa-bebb795dceee
STATE_BACKLOG=e1a32275-6a9a-4df0-8eb5-dc7afb12cdd6

: "${LINEAR_API_KEY:?LINEAR_API_KEY is not set — add it to .sandcastle/.env}"

# gql QUERY VARIABLES_JSON — prints the response, or the error and exits 1.
gql() {
  local response
  response=$(jq -n --arg q "$1" --argjson v "$2" '{query: $q, variables: $v}' \
    | curl -s https://api.linear.app/graphql \
        -H "Authorization: $LINEAR_API_KEY" \
        -H 'Content-Type: application/json' \
        -d @-)
  if jq -e '.errors' <<<"$response" >/dev/null; then
    jq -r '.errors[] | "linear: \(.extensions.userPresentableMessage // .message)"' <<<"$response" >&2
    exit 1
  fi
  printf '%s\n' "$response"
}

move() {
  gql 'mutation($id: String!, $state: String!) {
         issueUpdate(id: $id, input: {stateId: $state}) { issue { identifier state { name } } }
       }' "$(jq -n --arg id "$1" --arg state "$2" '{id: $id, state: $state}')" \
    | jq -r '.data.issueUpdate.issue | "\(.identifier) -> \(.state.name)"'
}

usage() { sed -n '5,10p' "$0" | sed 's/^# //'; exit 2; }

cmd=${1:-}; id=${2:-}
[[ -z $cmd ]] && usage
[[ $cmd != list && -z $id ]] && usage

case $cmd in
  list)
    gql 'query($project: ID!) {
           issues(first: 100, filter: {project: {id: {eq: $project}}, state: {type: {eq: "unstarted"}}}) {
             nodes { identifier title description }
           }
         }' "$(jq -n --arg p "$PROJECT_ID" '{project: $p}')" \
      | jq '[.data.issues.nodes[] | {id: .identifier, title, body: (.description // "")}]'
    ;;
  view)
    gql 'query($id: String!) {
           issue(id: $id) {
             identifier title description state { name }
             comments { nodes { createdAt body user { name } } }
           }
         }' "$(jq -n --arg id "$id" '{id: $id}')" \
      | jq '.data.issue'
    ;;
  comment)
    [[ -z ${3:-} ]] && usage
    gql 'mutation($id: String!, $body: String!) {
           commentCreate(input: {issueId: $id, body: $body}) { success }
         }' "$(jq -n --arg id "$id" --arg body "$3" '{id: $id, body: $body}')" \
      | jq -r --arg id "$id" 'if .data.commentCreate.success then "comment added to \($id)" else . end'
    ;;
  done)   move "$id" "$STATE_DONE" ;;
  review) move "$id" "$STATE_IN_REVIEW" ;;
  park)   move "$id" "$STATE_BACKLOG" ;;
  *) usage ;;
esac
