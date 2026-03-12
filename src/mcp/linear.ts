#!/usr/bin/env node
/**
 * Linear MCP Server
 * Provides tools for interacting with Linear's GraphQL API.
 * Supports multiple workspaces via a single API key.
 */

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const LINEAR_API_URL = "https://api.linear.app/graphql";

async function linearQuery(
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(LINEAR_API_URL, {
      method: "POST",
      headers: {
        Authorization: LINEAR_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
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

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const tools = [
  {
    name: "linear_list_teams",
    description: "List all teams across workspaces you have access to. Use this first to find team IDs.",
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
      const data = (await linearQuery(`
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
      `)) as { teams: { nodes: Array<Record<string, unknown>> } };
      return data.teams.nodes;
    }

    case "linear_search_issues": {
      const limit = Math.min((args.limit as number) || 25, 50);

      // Build filter object
      const filter: Record<string, unknown> = {};
      if (args.team_key) {
        filter.team = { key: { eq: args.team_key } };
      }
      if (args.assignee_name) {
        filter.assignee = { displayName: { containsIgnoreCase: args.assignee_name } };
      }
      if (args.status) {
        filter.state = { name: { eqIgnoreCase: args.status } };
      }

      // If free-text query, use the search endpoint
      if (args.query) {
        const data = (await linearQuery(
          `
          query($query: String!, $limit: Int!) {
            searchIssues(term: $query, first: $limit, filter: $filter) {
              nodes {
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
              }
            }
          }
        `,
          { query: args.query, limit, filter: Object.keys(filter).length > 0 ? filter : undefined },
        )) as { searchIssues: { nodes: unknown[] } };
        return data.searchIssues.nodes;
      }

      // Otherwise use filtered list
      const data = (await linearQuery(
        `
        query($filter: IssueFilter, $limit: Int!) {
          issues(filter: $filter, first: $limit, orderBy: updatedAt) {
            nodes {
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
            }
          }
        }
      `,
        { filter: Object.keys(filter).length > 0 ? filter : undefined, limit },
      )) as { issues: { nodes: unknown[] } };
      return data.issues.nodes;
    }

    case "linear_get_issue": {
      // Parse identifier like "MIT-123" into parts
      const identifier = args.identifier as string;

      const data = (await linearQuery(
        `
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
        {
          filter: {
            number: { eq: parseInt(identifier.split("-")[1]) },
            team: { key: { eq: identifier.split("-")[0] } },
          },
        },
      )) as { issues: { nodes: unknown[] } };

      if (data.issues.nodes.length === 0) {
        return { error: `Issue ${identifier} not found` };
      }
      return data.issues.nodes[0];
    }

    case "linear_create_issue": {
      const input: Record<string, unknown> = {
        teamId: args.team_id,
        title: args.title,
      };
      if (args.description) input.description = args.description;
      if (args.priority != null) input.priority = args.priority;
      if (args.assignee_id) input.assigneeId = args.assignee_id;

      // Resolve status name to state ID if provided
      if (args.status_name) {
        const states = (await linearQuery(
          `
          query($teamId: String!) {
            workflowStates(filter: { team: { id: { eq: $teamId } } }) {
              nodes { id, name }
            }
          }
        `,
          { teamId: args.team_id },
        )) as { workflowStates: { nodes: Array<{ id: string; name: string }> } };

        const match = states.workflowStates.nodes.find(
          (s) => s.name.toLowerCase() === (args.status_name as string).toLowerCase(),
        );
        if (match) input.stateId = match.id;
      }

      // Resolve label names to IDs if provided
      if (args.label_names && (args.label_names as string[]).length > 0) {
        const labels = (await linearQuery(
          `
          query($teamId: String!) {
            issueLabels(filter: { team: { id: { eq: $teamId } } }) {
              nodes { id, name }
            }
          }
        `,
          { teamId: args.team_id },
        )) as { issueLabels: { nodes: Array<{ id: string; name: string }> } };

        const labelIds = (args.label_names as string[])
          .map((name) => labels.issueLabels.nodes.find((l) => l.name.toLowerCase() === name.toLowerCase()))
          .filter(Boolean)
          .map((l) => l!.id);
        if (labelIds.length > 0) input.labelIds = labelIds;
      }

      const data = (await linearQuery(
        `
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
        { input },
      )) as { issueCreate: { success: boolean; issue: unknown } };

      return data.issueCreate;
    }

    case "linear_update_issue": {
      const input: Record<string, unknown> = {};
      if (args.title) input.title = args.title;
      if (args.description) input.description = args.description;
      if (args.priority != null) input.priority = args.priority;
      if (args.assignee_id) input.assigneeId = args.assignee_id;

      // Resolve status name if provided
      if (args.status_name) {
        // First get the issue's team to find valid states
        const issueData = (await linearQuery(
          `query($id: String!) { issue(id: $id) { team { id } } }`,
          { id: args.issue_id },
        )) as { issue: { team: { id: string } } };

        const states = (await linearQuery(
          `
          query($teamId: String!) {
            workflowStates(filter: { team: { id: { eq: $teamId } } }) {
              nodes { id, name }
            }
          }
        `,
          { teamId: issueData.issue.team.id },
        )) as { workflowStates: { nodes: Array<{ id: string; name: string }> } };

        const match = states.workflowStates.nodes.find(
          (s) => s.name.toLowerCase() === (args.status_name as string).toLowerCase(),
        );
        if (match) input.stateId = match.id;
      }

      const data = (await linearQuery(
        `
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
        { id: args.issue_id, input },
      )) as { issueUpdate: { success: boolean; issue: unknown } };

      return data.issueUpdate;
    }

    case "linear_add_comment": {
      const data = (await linearQuery(
        `
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
        { input: { issueId: args.issue_id, body: args.body } },
      )) as { commentCreate: { success: boolean; comment: unknown } };

      return data.commentCreate;
    }

    case "linear_list_projects": {
      const filter: Record<string, unknown> = {};
      if (args.team_key) {
        filter.accessibleTeams = { some: { key: { eq: args.team_key } } };
      }

      const data = (await linearQuery(
        `
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
        { filter: Object.keys(filter).length > 0 ? filter : undefined },
      )) as { projects: { nodes: unknown[] } };
      return data.projects.nodes;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// MCP stdio server
// ---------------------------------------------------------------------------

async function main() {
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
