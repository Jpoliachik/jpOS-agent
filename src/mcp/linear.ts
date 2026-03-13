#!/usr/bin/env node
/**
 * Linear MCP Server
 * Provides tools for interacting with Linear's GraphQL API.
 * Supports multiple orgs via comma-separated API keys in LINEAR_API_KEYS.
 */

const LINEAR_API_URL = "https://api.linear.app/graphql";

// Parse comma-separated keys
const apiKeys = (process.env.LINEAR_API_KEYS || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

// Cache: team key -> API key, team ID -> API key
const teamKeyToApiKey = new Map<string, string>();
const teamIdToApiKey = new Map<string, string>();
let mappingInitialized = false;

async function linearQuery(params: {
  query: string;
  variables?: Record<string, unknown>;
  apiKey: string;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(LINEAR_API_URL, {
      method: "POST",
      headers: {
        Authorization: params.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: params.query, variables: params.variables }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as { data?: unknown; errors?: Array<{ message: string }> };
    if (json.errors) {
      throw new Error(`Linear GraphQL error: ${json.errors.map((e) => e.message).join(", ")}`);
    }

    return json.data;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Query using the API key mapped to a team key. Falls back to trying all keys. */
async function linearQueryForTeam(params: {
  query: string;
  variables?: Record<string, unknown>;
  teamKey?: string;
  teamId?: string;
}): Promise<unknown> {
  await ensureMapping();

  const key =
    (params.teamKey && teamKeyToApiKey.get(params.teamKey)) ||
    (params.teamId && teamIdToApiKey.get(params.teamId));

  if (key) {
    return linearQuery({ query: params.query, variables: params.variables, apiKey: key });
  }

  // Unknown team — try each key until one works
  for (const apiKey of apiKeys) {
    try {
      return await linearQuery({ query: params.query, variables: params.variables, apiKey });
    } catch {
      continue;
    }
  }
  throw new Error("All Linear API keys failed for this request");
}

/** Build team -> API key mapping by querying each key's teams. */
async function ensureMapping(): Promise<void> {
  if (mappingInitialized) return;

  for (const apiKey of apiKeys) {
    try {
      const data = (await linearQuery({
        query: `query { teams { nodes { id, key } } }`,
        apiKey,
      })) as { teams: { nodes: Array<{ id: string; key: string }> } };

      for (const team of data.teams.nodes) {
        teamKeyToApiKey.set(team.key, apiKey);
        teamIdToApiKey.set(team.id, apiKey);
      }
    } catch (err) {
      console.error(`Failed to query teams for a Linear API key: ${err}`);
    }
  }
  mappingInitialized = true;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const tools = [
  {
    name: "linear_list_teams",
    description: "List all teams across all connected Linear orgs. Use this first to find team IDs and keys.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "linear_search_issues",
    description:
      "Search for issues. Can filter by team, assignee, status, or free-text query. Returns up to 50 results.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search query" },
        team_key: { type: "string", description: "Team key/identifier (e.g., 'MIT', 'RET')" },
        assignee_name: { type: "string", description: "Filter by assignee display name (partial match)" },
        status: { type: "string", description: "Filter by status name (e.g., 'In Progress', 'Todo', 'Done')" },
        limit: { type: "number", description: "Max results (default 25, max 50)" },
      },
    },
  },
  {
    name: "linear_get_issue",
    description: "Get full details of a specific issue by its identifier (e.g., 'MIT-123').",
    inputSchema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Issue identifier like 'MIT-123'" },
      },
      required: ["identifier"],
    },
  },
  {
    name: "linear_create_issue",
    description: "Create a new issue in Linear.",
    inputSchema: {
      type: "object",
      properties: {
        team_id: { type: "string", description: "Team ID (use linear_list_teams to find this)" },
        title: { type: "string", description: "Issue title" },
        description: { type: "string", description: "Issue description (markdown supported)" },
        priority: {
          type: "number",
          description: "Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low",
        },
        status_name: {
          type: "string",
          description: "Status name (e.g., 'Todo', 'In Progress'). Must match a workflow state for the team.",
        },
        assignee_id: { type: "string", description: "Assignee user ID" },
        label_names: {
          type: "array",
          items: { type: "string" },
          description: "Label names to apply",
        },
      },
      required: ["team_id", "title"],
    },
  },
  {
    name: "linear_update_issue",
    description: "Update an existing issue. Only provided fields are changed.",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: { type: "string", description: "Issue ID (UUID, not the human identifier)" },
        title: { type: "string", description: "New title" },
        description: { type: "string", description: "New description" },
        priority: { type: "number", description: "Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low" },
        status_name: { type: "string", description: "New status name" },
        assignee_id: { type: "string", description: "New assignee user ID" },
      },
      required: ["issue_id"],
    },
  },
  {
    name: "linear_add_comment",
    description: "Add a comment to an issue.",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: { type: "string", description: "Issue ID (UUID)" },
        body: { type: "string", description: "Comment body (markdown supported)" },
      },
      required: ["issue_id", "body"],
    },
  },
  {
    name: "linear_list_projects",
    description: "List projects, optionally filtered by team.",
    inputSchema: {
      type: "object",
      properties: {
        team_key: { type: "string", description: "Filter by team key" },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "linear_list_teams": {
      await ensureMapping();
      const allTeams: Array<Record<string, unknown>> = [];

      for (const apiKey of apiKeys) {
        const data = (await linearQuery({
          query: `
            query {
              teams {
                nodes {
                  id
                  name
                  key
                  organization { name }
                }
              }
            }
          `,
          apiKey,
        })) as { teams: { nodes: Array<Record<string, unknown>> } };
        allTeams.push(...data.teams.nodes);
      }

      return allTeams;
    }

    case "linear_search_issues": {
      const limit = Math.min((args.limit as number) || 25, 50);
      const teamKey = args.team_key as string | undefined;

      // Build filter object
      const filter: Record<string, unknown> = {};
      if (teamKey) {
        filter.team = { key: { eq: teamKey } };
      }
      if (args.assignee_name) {
        filter.assignee = { displayName: { containsIgnoreCase: args.assignee_name } };
      }
      if (args.status) {
        filter.state = { name: { eqIgnoreCase: args.status } };
      }

      // If we know the team, query that org. Otherwise query all orgs.
      if (teamKey) {
        return searchIssuesWithKey({
          query: args.query as string | undefined,
          filter,
          limit,
          teamKey,
        });
      }

      // No team specified — search across all orgs and merge results
      await ensureMapping();
      const allResults: unknown[] = [];
      const seenKeys = new Set<string>();

      for (const apiKey of apiKeys) {
        if (seenKeys.has(apiKey)) continue;
        seenKeys.add(apiKey);
        try {
          const results = await searchIssuesRaw({
            query: args.query as string | undefined,
            filter,
            limit,
            apiKey,
          });
          allResults.push(...results);
        } catch {
          continue;
        }
      }

      return allResults.slice(0, limit);
    }

    case "linear_get_issue": {
      const identifier = args.identifier as string;
      const teamKey = identifier.split("-")[0];

      const data = (await linearQueryForTeam({
        query: `
          query($filter: IssueFilter!) {
            issues(filter: $filter, first: 1) {
              nodes {
                id
                identifier
                title
                description
                priority
                state { name }
                assignee { id, displayName }
                team { key, name }
                labels { nodes { name } }
                project { name }
                url
                createdAt
                updatedAt
                comments {
                  nodes {
                    body
                    user { displayName }
                    createdAt
                  }
                }
              }
            }
          }
        `,
        variables: {
          filter: {
            number: { eq: parseInt(identifier.split("-")[1]) },
            team: { key: { eq: teamKey } },
          },
        },
        teamKey,
      })) as { issues: { nodes: unknown[] } };

      if (data.issues.nodes.length === 0) {
        return { error: `Issue ${identifier} not found` };
      }
      return data.issues.nodes[0];
    }

    case "linear_create_issue": {
      const teamId = args.team_id as string;
      const input: Record<string, unknown> = {
        teamId,
        title: args.title,
      };
      if (args.description) input.description = args.description;
      if (args.priority != null) input.priority = args.priority;
      if (args.assignee_id) input.assigneeId = args.assignee_id;

      // Resolve status name to state ID if provided
      if (args.status_name) {
        const states = (await linearQueryForTeam({
          query: `
            query($teamId: String!) {
              workflowStates(filter: { team: { id: { eq: $teamId } } }) {
                nodes { id, name }
              }
            }
          `,
          variables: { teamId },
          teamId,
        })) as { workflowStates: { nodes: Array<{ id: string; name: string }> } };

        const match = states.workflowStates.nodes.find(
          (s) => s.name.toLowerCase() === (args.status_name as string).toLowerCase(),
        );
        if (match) input.stateId = match.id;
      }

      // Resolve label names to IDs if provided
      if (args.label_names && (args.label_names as string[]).length > 0) {
        const labels = (await linearQueryForTeam({
          query: `
            query($teamId: String!) {
              issueLabels(filter: { team: { id: { eq: $teamId } } }) {
                nodes { id, name }
              }
            }
          `,
          variables: { teamId },
          teamId,
        })) as { issueLabels: { nodes: Array<{ id: string; name: string }> } };

        const labelIds = (args.label_names as string[])
          .map((n) => labels.issueLabels.nodes.find((l) => l.name.toLowerCase() === n.toLowerCase()))
          .filter(Boolean)
          .map((l) => l!.id);
        if (labelIds.length > 0) input.labelIds = labelIds;
      }

      const data = (await linearQueryForTeam({
        query: `
          mutation($input: IssueCreateInput!) {
            issueCreate(input: $input) {
              success
              issue {
                id
                identifier
                title
                url
              }
            }
          }
        `,
        variables: { input },
        teamId,
      })) as { issueCreate: { success: boolean; issue: unknown } };

      return data.issueCreate;
    }

    case "linear_update_issue": {
      const issueId = args.issue_id as string;
      const input: Record<string, unknown> = {};
      if (args.title) input.title = args.title;
      if (args.description) input.description = args.description;
      if (args.priority != null) input.priority = args.priority;
      if (args.assignee_id) input.assigneeId = args.assignee_id;

      // Resolve status name if provided
      if (args.status_name) {
        const issueData = (await linearQueryForTeam({
          query: `query($id: String!) { issue(id: $id) { team { id } } }`,
          variables: { id: issueId },
        })) as { issue: { team: { id: string } } };

        const states = (await linearQueryForTeam({
          query: `
            query($teamId: String!) {
              workflowStates(filter: { team: { id: { eq: $teamId } } }) {
                nodes { id, name }
              }
            }
          `,
          variables: { teamId: issueData.issue.team.id },
          teamId: issueData.issue.team.id,
        })) as { workflowStates: { nodes: Array<{ id: string; name: string }> } };

        const match = states.workflowStates.nodes.find(
          (s) => s.name.toLowerCase() === (args.status_name as string).toLowerCase(),
        );
        if (match) input.stateId = match.id;
      }

      const data = (await linearQueryForTeam({
        query: `
          mutation($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success
              issue {
                id
                identifier
                title
                state { name }
                url
              }
            }
          }
        `,
        variables: { id: issueId, input },
      })) as { issueUpdate: { success: boolean; issue: unknown } };

      return data.issueUpdate;
    }

    case "linear_add_comment": {
      const data = (await linearQueryForTeam({
        query: `
          mutation($input: CommentCreateInput!) {
            commentCreate(input: $input) {
              success
              comment {
                id
                body
                user { displayName }
                createdAt
              }
            }
          }
        `,
        variables: { input: { issueId: args.issue_id, body: args.body } },
      })) as { commentCreate: { success: boolean; comment: unknown } };

      return data.commentCreate;
    }

    case "linear_list_projects": {
      const teamKey = args.team_key as string | undefined;
      const filter: Record<string, unknown> = {};
      if (teamKey) {
        filter.accessibleTeams = { some: { key: { eq: teamKey } } };
      }

      if (teamKey) {
        const data = (await linearQueryForTeam({
          query: `
            query($filter: ProjectFilter) {
              projects(filter: $filter, first: 50) {
                nodes {
                  id
                  name
                  state
                  teams { nodes { key, name } }
                  url
                  startDate
                  targetDate
                }
              }
            }
          `,
          variables: { filter: Object.keys(filter).length > 0 ? filter : undefined },
          teamKey,
        })) as { projects: { nodes: unknown[] } };
        return data.projects.nodes;
      }

      // No team — merge from all orgs
      await ensureMapping();
      const allProjects: unknown[] = [];
      const seenKeys = new Set<string>();
      for (const apiKey of apiKeys) {
        if (seenKeys.has(apiKey)) continue;
        seenKeys.add(apiKey);
        try {
          const data = (await linearQuery({
            query: `
              query {
                projects(first: 50) {
                  nodes {
                    id
                    name
                    state
                    teams { nodes { key, name } }
                    url
                    startDate
                    targetDate
                  }
                }
              }
            `,
            apiKey,
          })) as { projects: { nodes: unknown[] } };
          allProjects.push(...data.projects.nodes);
        } catch {
          continue;
        }
      }
      return allProjects;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

const ISSUE_FIELDS = `
  id
  identifier
  title
  priority
  state { name }
  assignee { displayName }
  team { key, name }
  url
  createdAt
  updatedAt
`;

async function searchIssuesRaw(params: {
  query?: string;
  filter: Record<string, unknown>;
  limit: number;
  apiKey: string;
}): Promise<unknown[]> {
  const hasFilter = Object.keys(params.filter).length > 0;

  if (params.query) {
    const data = (await linearQuery({
      query: `
        query($term: String!, $limit: Int!, $filter: IssueFilter) {
          searchIssues(term: $term, first: $limit, filter: $filter) {
            nodes { ${ISSUE_FIELDS} }
          }
        }
      `,
      variables: {
        term: params.query,
        limit: params.limit,
        filter: hasFilter ? params.filter : undefined,
      },
      apiKey: params.apiKey,
    })) as { searchIssues: { nodes: unknown[] } };
    return data.searchIssues.nodes;
  }

  const data = (await linearQuery({
    query: `
      query($filter: IssueFilter, $limit: Int!) {
        issues(filter: $filter, first: $limit, orderBy: updatedAt) {
          nodes { ${ISSUE_FIELDS} }
        }
      }
    `,
    variables: {
      filter: hasFilter ? params.filter : undefined,
      limit: params.limit,
    },
    apiKey: params.apiKey,
  })) as { issues: { nodes: unknown[] } };
  return data.issues.nodes;
}

async function searchIssuesWithKey(params: {
  query?: string;
  filter: Record<string, unknown>;
  limit: number;
  teamKey: string;
}): Promise<unknown[]> {
  await ensureMapping();
  const apiKey = teamKeyToApiKey.get(params.teamKey);
  if (!apiKey) {
    throw new Error(`Unknown team key: ${params.teamKey}. Use linear_list_teams to see available teams.`);
  }
  return searchIssuesRaw({ ...params, apiKey });
}

// ---------------------------------------------------------------------------
// MCP stdio server
// ---------------------------------------------------------------------------

async function main() {
  if (apiKeys.length === 0) {
    console.error("LINEAR_API_KEYS env var is empty — no Linear orgs configured");
    process.exit(1);
  }

  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  for await (const line of rl) {
    let requestId: unknown = null;
    try {
      const request = JSON.parse(line);
      requestId = request.id;
      let response: unknown;

      switch (request.method) {
        case "initialize":
          response = {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "linear-mcp", version: "1.0.0" },
          };
          break;

        case "tools/list":
          response = { tools };
          break;

        case "tools/call": {
          const result = await handleToolCall(request.params.name, request.params.arguments || {});
          response = {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
          break;
        }

        default:
          response = { error: { code: -32601, message: "Method not found" } };
      }

      console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: response }));
    } catch (error) {
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          error: { code: -32603, message: error instanceof Error ? error.message : "Unknown error" },
        }),
      );
    }
  }
}

main().catch(console.error);
