export interface Pull {
	user: { login: string } | null;
	number: number;
}

export interface Logger {
	startGroup(name: string): void;
	endGroup(): void;
	info(message: string): void;
	debug(message: string): void;
	error(message: string): void;
	warning(message: string): void;
}

export interface ActionOutputs {
	setOutput(name: string, value: string): void;
	setFailed(message: string): void;
	addSummary(heading: string, table: Array<[string, string]>): Promise<void>;
}

export interface GitHubService {
	setReviewers(prNumber: number, reviewers: string[]): Promise<object>;
	getExistingReviewers(prNumber: number): Promise<string[]>;
	getPRAuthor(prNumber: number): Promise<string>;
	findPRByRef(ref: string): Promise<Pull | undefined>;
}

export interface Env {
	repository: string;
	ref: string;
}

export interface PRInfo {
	prNumber: number;
	repository: string;
	ref: string;
	author?: string;
}
