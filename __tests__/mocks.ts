import type { ActionOutputs, GitHubService, Logger, Pull } from "../src/interfaces";

/**
 * Mock implementations for testing the Lottery class without GitHub dependencies
 */

export class MockLogger implements Logger {
	public calls: Array<{ method: string; args: unknown[] }> = [];

	startGroup(name: string): void {
		this.calls.push({ method: "startGroup", args: [name] });
	}

	endGroup(): void {
		this.calls.push({ method: "endGroup", args: [] });
	}

	info(message: string): void {
		this.calls.push({ method: "info", args: [message] });
	}

	debug(message: string): void {
		this.calls.push({ method: "debug", args: [message] });
	}

	error(message: string): void {
		this.calls.push({ method: "error", args: [message] });
	}

	warning(message: string): void {
		this.calls.push({ method: "warning", args: [message] });
	}

	// Helper methods for testing
	getCallsForMethod(method: string): Array<{ method: string; args: unknown[] }> {
		return this.calls.filter((call) => call.method === method);
	}

	wasCalledWith(method: string, ...args: unknown[]): boolean {
		return this.calls.some(
			(call) => call.method === method && 
			JSON.stringify(call.args) === JSON.stringify(args)
		);
	}

	clear(): void {
		this.calls = [];
	}
}

export class MockActionOutputs implements ActionOutputs {
	public outputs: Record<string, string> = {};
	public failures: string[] = [];
	public summaries: Array<{ heading: string; table: Array<[string, string]> }> = [];

	setOutput(name: string, value: string): void {
		this.outputs[name] = value;
	}

	setFailed(message: string): void {
		this.failures.push(message);
	}

	async addSummary(heading: string, table: Array<[string, string]>): Promise<void> {
		this.summaries.push({ heading, table });
	}

	// Helper methods for testing
	getOutput(name: string): string | undefined {
		return this.outputs[name];
	}

	wasFailed(): boolean {
		return this.failures.length > 0;
	}

	getFailures(): string[] {
		return this.failures;
	}

	getSummaries(): Array<{ heading: string; table: Array<[string, string]> }> {
		return this.summaries;
	}

	clear(): void {
		this.outputs = {};
		this.failures = [];
		this.summaries = [];
	}
}

export class MockGitHubService implements GitHubService {
	public calls: Array<{ method: string; args: unknown[] }> = [];
	public mockPRs: Map<string, Pull> = new Map();
	public mockExistingReviewers: Map<number, string[]> = new Map();
	public mockPRAuthors: Map<number, string> = new Map();
	public shouldThrowErrors: Map<string, Error> = new Map();

	async setReviewers(prNumber: number, reviewers: string[]): Promise<object> {
		this.calls.push({ method: "setReviewers", args: [prNumber, reviewers] });
		
		if (this.shouldThrowErrors.has("setReviewers")) {
			throw this.shouldThrowErrors.get("setReviewers");
		}

		return { number: prNumber, reviewers };
	}

	async getExistingReviewers(prNumber: number): Promise<string[]> {
		this.calls.push({ method: "getExistingReviewers", args: [prNumber] });
		
		if (this.shouldThrowErrors.has("getExistingReviewers")) {
			throw this.shouldThrowErrors.get("getExistingReviewers");
		}

		return this.mockExistingReviewers.get(prNumber) || [];
	}

	async getPRAuthor(prNumber: number): Promise<string> {
		this.calls.push({ method: "getPRAuthor", args: [prNumber] });
		
		if (this.shouldThrowErrors.has("getPRAuthor")) {
			throw this.shouldThrowErrors.get("getPRAuthor");
		}

		return this.mockPRAuthors.get(prNumber) || "";
	}

	async findPRByRef(ref: string): Promise<Pull | undefined> {
		this.calls.push({ method: "findPRByRef", args: [ref] });
		
		if (this.shouldThrowErrors.has("findPRByRef")) {
			throw this.shouldThrowErrors.get("findPRByRef");
		}

		return this.mockPRs.get(ref);
	}

	// Helper methods for testing
	mockPR(ref: string, pr: Pull): void {
		this.mockPRs.set(ref, pr);
	}

	mockExistingReviewersForPR(prNumber: number, reviewers: string[]): void {
		this.mockExistingReviewers.set(prNumber, reviewers);
	}

	mockPRAuthorForPR(prNumber: number, author: string): void {
		this.mockPRAuthors.set(prNumber, author);
	}

	mockError(method: string, error: Error): void {
		this.shouldThrowErrors.set(method, error);
	}

	getCallsForMethod(method: string): Array<{ method: string; args: unknown[] }> {
		return this.calls.filter((call) => call.method === method);
	}

	wasCalledWith(method: string, ...args: unknown[]): boolean {
		return this.calls.some(
			(call) => call.method === method && 
			JSON.stringify(call.args) === JSON.stringify(args)
		);
	}

	clear(): void {
		this.calls = [];
		this.mockPRs.clear();
		this.mockExistingReviewers.clear();
		this.mockPRAuthors.clear();
		this.shouldThrowErrors.clear();
	}
}

/**
 * Test utilities for creating mock scenarios
 */
export interface TestScenario {
	author: string;
	prNumber: number;
	ref: string;
	repository: string;
	teams: Array<{
		name: string;
		members: string[];
	}>;
	existingReviewers?: string[];
}

export function createMockServices(scenario: TestScenario) {
	const logger = new MockLogger();
	const actionOutputs = new MockActionOutputs();
	const githubService = new MockGitHubService();

	// Setup mock data
	githubService.mockPR(scenario.ref, {
		number: scenario.prNumber,
		user: { login: scenario.author },
	});

	githubService.mockPRAuthorForPR(scenario.prNumber, scenario.author);
	
	if (scenario.existingReviewers) {
		githubService.mockExistingReviewersForPR(scenario.prNumber, scenario.existingReviewers);
	}

	return { logger, actionOutputs, githubService };
}