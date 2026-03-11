// Linear API response types

export interface Team {
  id: string;
  name: string;
}

export interface WorkflowState {
  id: string;
  name: string;
  type: string;
  position: number;
  color: string;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Assignee {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface Cycle {
  id: string;
  name: string | null;
  number: number;
  startsAt: string;
  endsAt: string;
}

export interface Project {
  id: string;
  name: string;
}

export interface IssueHistoryEntry {
  createdAt: string;
  toState: { id: string } | null;
}

export interface SubIssue {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  createdAt: string;
  cycle: Cycle | null;
  assignee: Assignee | null;
  state: WorkflowState;
  labels: { nodes: Label[] };
  history?: { nodes: IssueHistoryEntry[] };
  children?: { nodes: SubIssue[] };
}

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  sortOrder: number;
  prioritySortOrder: number;
  team: Team;
  state: { id: string; name: string; type: string; color: string };
  cycle: Cycle | null;
  project: Project | null;
  assignee: Assignee | null;
  labels: { nodes: Label[] };
  children: { nodes: SubIssue[] };
}

// Whiteboard data model

export interface BoardColumn {
  id: string;
  name: string;
  type: string;
  color: string;
}

export interface BoardRowIssue {
  id: string;
  identifier: string;
  title: string;
  state: { id: string; name: string; type: string; color: string };
  project: Project | null;
  assignee: Assignee | null;
}

export interface BoardRow {
  issue: BoardRowIssue;
  cells: Record<string, SubIssue[]>;
}

export interface BoardData {
  columns: BoardColumn[];
  rows: BoardRow[];
}

// Custom View

export interface ViewPreferences {
  issueGrouping: string | null;
  viewOrdering: string | null;
  viewOrderingDirection: string | null;
}

export interface CustomViewData {
  id: string;
  name: string;
  viewPreferencesValues: ViewPreferences | null;
  issues: { nodes: Issue[] };
}

// Grouping

export interface IssueGroup {
  label: string;
  issues: Issue[];
}

// Settings

export interface Settings {
  apiKey: string;
  teamId: string;
  teamName: string;
}
