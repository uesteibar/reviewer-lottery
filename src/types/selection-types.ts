export interface ReviewerSelectionResult {
	selectedReviewers: string[];
	appliedRule: AppliedRule | null;
	process: SelectionStep[];
}

export interface AppliedRule {
	type: "default" | "by_author_group" | "non_group_members" | "merged_groups";
	index?: number;
	rule: Record<string, number>;
	mergedFromGroups?: string[];
	usedGroup?: string;
}

export interface SelectionStep {
	step: number;
	description: string;
	groupKey: string;
	candidates: string[];
	required: number;
	selected: string[];
}

export interface TestScenarioResult {
	scenario: {
		author: string;
		authorGroup: string | null;
	};
	result: ReviewerSelectionResult;
}

export interface ConfigTestResult {
	scenarios: TestScenarioResult[];
}
