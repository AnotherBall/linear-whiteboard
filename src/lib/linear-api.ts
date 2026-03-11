import type { Team, WorkflowState, CustomViewData, Issue, SubIssue, Cycle } from "./types";

const API_URL = "https://api.linear.app/graphql";

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

async function fetchGraphQL<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const json: GraphQLResponse<T> = await res.json();
  if (json.errors) {
    throw new Error(json.errors[0].message);
  }
  if (!json.data) {
    throw new Error("No data in response");
  }

  return json.data;
}

// Fetch all teams for the authenticated user
export async function fetchTeams(
  apiKey: string
): Promise<Team[]> {
  const query = `
    query Teams {
      teams {
        nodes {
          id
          name
        }
      }
    }
  `;

  const data = await fetchGraphQL<{ teams: { nodes: Team[] } }>(apiKey, query);
  return data.teams.nodes;
}

// Fetch cycles for a team (sorted by startsAt descending)
export async function fetchTeamCycles(
  apiKey: string,
  teamId: string
): Promise<Cycle[]> {
  const query = `
    query TeamCycles($teamId: String!) {
      team(id: $teamId) {
        cycles(first: 20) {
          nodes {
            id
            name
            number
            startsAt
            endsAt
          }
        }
      }
    }
  `;

  const data = await fetchGraphQL<{
    team: { cycles: { nodes: Cycle[] } };
  }>(apiKey, query, { teamId });

  // Sort descending by startsAt (most recent first)
  return data.team.cycles.nodes.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

// Fetch workflow states for a team
export async function fetchWorkflowStates(
  apiKey: string,
  teamId: string
): Promise<WorkflowState[]> {
  const query = `
    query WorkflowStates($teamId: String!) {
      team(id: $teamId) {
        states {
          nodes {
            id
            name
            type
            position
            color
          }
        }
      }
    }
  `;

  const data = await fetchGraphQL<{
    team: { states: { nodes: WorkflowState[] } };
  }>(apiKey, query, { teamId });

  // Sort by workflow type order (unstarted → started → completed), then by position within each type
  const typeOrder: Record<string, number> = { unstarted: 0, started: 1, completed: 2 };
  return data.team.states.nodes.sort((a, b) => {
    const ta = typeOrder[a.type] ?? 99;
    const tb = typeOrder[b.type] ?? 99;
    if (ta !== tb) return ta - tb;
    return a.position - b.position;
  });
}

// Issue fields fragment (shared between initial and paginated queries)
const ISSUE_FIELDS = `
  id
  identifier
  title
  priority
  sortOrder
  prioritySortOrder
  team {
    id
    name
  }
  state {
    id
    name
    type
    color
  }
  cycle {
    id
    name
    number
    startsAt
    endsAt
  }
  project {
    id
    name
  }
  assignee {
    id
    name
    avatarUrl
  }
  parent {
    id
  }
  labels {
    nodes {
      id
      name
      color
    }
  }
`;

const CHILD_FIELDS = `
  id
  identifier
  title
  priority
  createdAt
  cycle {
    id
    name
    number
    startsAt
    endsAt
  }
  history(first: 20) {
    nodes {
      createdAt
      toState { id }
    }
  }
  assignee {
    id
    name
    avatarUrl
  }
  state {
    id
    name
    type
    color
  }
  labels {
    nodes {
      id
      name
      color
    }
  }
  children(first: 100) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      identifier
      title
      priority
      createdAt
      cycle {
        id
        name
        number
        startsAt
        endsAt
      }
      history(first: 20) {
        nodes {
          createdAt
          toState { id }
        }
      }
      assignee {
        id
        name
        avatarUrl
      }
      state {
        id
        name
        type
        color
      }
      labels {
        nodes {
          id
          name
          color
        }
      }
    }
  }
`;

// Paginated response types
interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface IssueNodeRaw {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  sortOrder: number;
  prioritySortOrder: number;
  team: { id: string; name: string };
  state: { id: string; name: string; type: string; color: string };
  cycle: { id: string; name: string | null; number: number; startsAt: string; endsAt: string } | null;
  project: { id: string; name: string } | null;
  parent: { id: string } | null;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
  labels: { nodes: { id: string; name: string; color: string }[] };
  children: {
    pageInfo: PageInfo;
    nodes: SubIssue[];
  };
}

interface CustomViewRaw {
  id: string;
  name: string;
  viewPreferencesValues: { issueGrouping: string | null; viewOrdering: string | null; viewOrderingDirection: string | null; showSubIssues: boolean | null } | null;
  issues: {
    pageInfo: PageInfo;
    nodes: IssueNodeRaw[];
  };
}

// Fetch issues from a Custom View with their sub-issues (fully paginated)
export async function fetchCustomViewIssues(
  apiKey: string,
  viewId: string
): Promise<CustomViewData> {
  const PAGE_SIZE = 100;

  // 1. Fetch all issues with pagination
  const allIssueNodes: IssueNodeRaw[] = [];
  let viewMeta: { id: string; name: string; viewPreferencesValues: { issueGrouping: string | null; viewOrdering: string | null; viewOrderingDirection: string | null; showSubIssues: boolean | null } | null; userViewPreferences?: any; organizationViewPreferences?: any } | null = null;
  let issuesCursor: string | null = null;
  let hasMoreIssues = true;

  while (hasMoreIssues) {
    const query = `
      query BoardData($viewId: String!, $first: Int!, $after: String) {
        customView(id: $viewId) {
          id
          name
          viewPreferencesValues {
            issueGrouping
            viewOrdering
            viewOrderingDirection
            showSubIssues
          }
          userViewPreferences {
            preferences {
              issueGrouping
              viewOrdering
              viewOrderingDirection
              showSubIssues
            }
          }
          organizationViewPreferences {
            preferences {
              issueGrouping
              viewOrdering
              viewOrderingDirection
              showSubIssues
            }
          }
          issues(first: $first, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              ${ISSUE_FIELDS}
              children(first: $first) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  ${CHILD_FIELDS}
                }
              }
            }
          }
        }
      }
    `;

    const result: { customView: CustomViewRaw } = await fetchGraphQL<{ customView: CustomViewRaw }>(
      apiKey,
      query,
      { viewId, first: PAGE_SIZE, after: issuesCursor }
    );

    if (!viewMeta) {
      viewMeta = {
        id: result.customView.id,
        name: result.customView.name,
        viewPreferencesValues: result.customView.viewPreferencesValues,
        userViewPreferences: (result.customView as any).userViewPreferences,
        organizationViewPreferences: (result.customView as any).organizationViewPreferences,
      };
    }

    allIssueNodes.push(...result.customView.issues.nodes);
    hasMoreIssues = result.customView.issues.pageInfo.hasNextPage;
    issuesCursor = result.customView.issues.pageInfo.endCursor;
  }

  // 2. For issues whose children have more pages, fetch remaining children
  for (const issue of allIssueNodes) {
    let childPageInfo = issue.children.pageInfo;
    while (childPageInfo.hasNextPage) {
      const query = `
        query MoreChildren($issueId: String!, $first: Int!, $after: String) {
          issue(id: $issueId) {
            children(first: $first, after: $after) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                ${CHILD_FIELDS}
              }
            }
          }
        }
      `;

      const data = await fetchGraphQL<{
        issue: { children: { pageInfo: PageInfo; nodes: SubIssue[] } };
      }>(apiKey, query, { issueId: issue.id, first: PAGE_SIZE, after: childPageInfo.endCursor });

      issue.children.nodes.push(...data.issue.children.nodes);
      childPageInfo = data.issue.children.pageInfo;
    }
  }

  // 3. Build result
  const userPrefs = viewMeta!.userViewPreferences?.preferences;
  const orgPrefs = viewMeta!.organizationViewPreferences?.preferences;
  const viewPrefs = viewMeta!.viewPreferencesValues;

  // Filter out sub-issues when "Show sub-issues" is off in the view
  const showSubIssues = userPrefs?.showSubIssues ?? orgPrefs?.showSubIssues ?? viewPrefs?.showSubIssues ?? false;
  const issues: Issue[] = allIssueNodes
    .filter((n) => showSubIssues || n.parent === null)
    .map((n) => ({
      ...n,
      children: { nodes: n.children.nodes },
    }));
  const ordering = userPrefs?.viewOrdering ?? orgPrefs?.viewOrdering ?? viewPrefs?.viewOrdering ?? "manual";
  const dirStr = userPrefs?.viewOrderingDirection ?? orgPrefs?.viewOrderingDirection ?? viewPrefs?.viewOrderingDirection;
  const descending = dirStr === "desc" || dirStr === "descending";
  const direction = descending ? -1 : 1;

  issues.sort((a, b) => {
    switch (ordering) {
      case "priority": {
        // No Priority (0) always goes to the end
        if (a.priority === 0 && b.priority !== 0) return 1;
        if (b.priority === 0 && a.priority !== 0) return -1;
        // Different priority levels:
        // desc: Urgent(1) → High(2) → Medium(3) → Low(4) = ascending numeric
        // asc: Low(4) → Medium(3) → High(2) → Urgent(1) = descending numeric
        if (a.priority !== b.priority) {
          return descending
            ? a.priority - b.priority
            : b.priority - a.priority;
        }
        // Same priority: sort by prioritySortOrder ascending
        return a.prioritySortOrder - b.prioritySortOrder;
      }
      default:
        // "manual" and any other ordering: use sortOrder
        return (a.sortOrder - b.sortOrder) * direction;
    }
  });

  // Merge preferences (user > org > view default) for grouping too
  const mergedPrefs: CustomViewData["viewPreferencesValues"] = {
    issueGrouping: userPrefs?.issueGrouping ?? orgPrefs?.issueGrouping ?? viewPrefs?.issueGrouping ?? null,
    viewOrdering: ordering,
    viewOrderingDirection: dirStr ?? null,
  };

  return {
    id: viewMeta!.id,
    name: viewMeta!.name,
    viewPreferencesValues: mergedPrefs,
    issues: { nodes: issues },
  };
}

// Update an issue's workflow state
export async function updateIssueState(
  apiKey: string,
  issueId: string,
  stateId: string
): Promise<void> {
  const query = `
    mutation UpdateIssueState($issueId: String!, $stateId: String!) {
      issueUpdate(id: $issueId, input: { stateId: $stateId }) {
        success
      }
    }
  `;
  await fetchGraphQL<{ issueUpdate: { success: boolean } }>(apiKey, query, { issueId, stateId });
}
