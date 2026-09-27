export interface IssueDraft {
  title: string;
  body: string;
  labels: string[];
  /** Stable non-sensitive correlation marker embedded in the body. */
  marker: string;
}

export interface CreatedIssue {
  /** GitHub's issue node/database ID. */
  id: number;
  /** Human issue number within the repository. */
  number: number;
  /** Canonical https://github.com issue URL. */
  url: string;
}

export interface IssueTrackerClient {
  createIssue(input: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    labels: string[];
  }): Promise<CreatedIssue>;
  /** Bounded scan of recent issues for a body marker; undefined when absent. */
  findIssueByMarker(input: {
    owner: string;
    repo: string;
    marker: string;
  }): Promise<CreatedIssue | undefined>;
  /** Repository label names for allowlist intersection. */
  listLabels(input: { owner: string; repo: string }): Promise<string[]>;
}

export interface TrackerFactory {
  forInstallation(installationId: string): Promise<IssueTrackerClient>;
}
