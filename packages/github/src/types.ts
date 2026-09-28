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
  /** Prove owner/name resolves to the stored repository under this installation. */
  verifyRepository(input: {
    owner: string;
    repo: string;
    repositoryId: string;
  }): Promise<void>;
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
    repositoryId: string;
  }): Promise<CreatedIssue | undefined>;
  /** Current remote state of one issue in the verified repository. */
  getIssueState(input: {
    owner: string;
    repo: string;
    number: number;
  }): Promise<{ state: "open" | "closed"; updatedAt?: string }>;
  /** Repository label names for allowlist intersection. */
  listLabels(input: { owner: string; repo: string }): Promise<string[]>;
}

export interface TrackerFactory {
  forInstallation(installationId: string): Promise<IssueTrackerClient>;
}
