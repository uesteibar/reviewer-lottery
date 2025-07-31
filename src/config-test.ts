#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import yaml from "js-yaml";
import { ReviewerSelector } from "../src/core/reviewer-selector";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/** Configuration structure for reviewer lottery */
interface ConfigType {
  groups: Array<{ name: string; usernames: string[] }>;
  selection_rules?: {
    default?: { from: Record<string, number> };
    by_author_group?: Array<{ group: string; from: Record<string, number> }>;
    non_group_members?: { from: Record<string, number> };
  };
}

/** Test scenario definition */
interface TestScenario {
  id: string;
  author: string;
  authorGroup: string | null;
  description: string;
}

/** Test result with statistics */
interface TestResult {
  scenario: TestScenario;
  results: string[][];
  statistics: {
    selectionCount: Map<string, number>;
    groupSelectionCount: Map<string, Map<string, number>>;
    successRate: number;
    mostSelected: string[];
  };
}

/** Reviewer selection result */
interface ReviewerSelection {
  selectedReviewers: string[];
  selectionDetails: Map<string, string>;
}

/** Selection data for display */
interface SelectionData {
  reviewer: string;
  count: number;
  groups: string[];
}

/** Cross-group member information */
interface CrossGroupMemberInfo {
  count: number;
  groups: string[];
  countedAsGroup: string;
}

/** Color types for output formatting */
type ColorType =
  | "title"
  | "header"
  | "group"
  | "percentage"
  | "good"
  | "warn"
  | "warning"
  | "error"
  | "info";

/** CLI options */
interface CliOptions {
  configPath: string;
  simulationRuns: number;
  colorEnabled: boolean;
}

// =============================================================================
// MAIN CONFIG TESTER CLASS
// =============================================================================

/**
 * Configuration tester for reviewer lottery system
 * Runs simulations to test configuration effectiveness
 */
class ConfigTester {
  private config: ConfigType;
  private reviewerSelector: ReviewerSelector;
  private simulationRuns: number;
  private colorEnabled: boolean;
  private configWarnings: string[] = [];

  constructor(
    configPath: string,
    simulationRuns: number = 1000,
    colorEnabled: boolean = true,
  ) {
    this.simulationRuns = simulationRuns;
    this.colorEnabled = colorEnabled;
    this.config = this.loadConfig(configPath);
    this.reviewerSelector = new ReviewerSelector(this.config);
  }

  /**
   * Main entry point for running configuration tests
   */
  async run(): Promise<void> {
    this.printTitle();
    this.displayConfigSummary();
    this.displayConfigWarnings();

    const scenarios = this.generateScenarios();
    const results = await this.runScenarios(scenarios);

    this.displayResults(results);
  }

  // =============================================================================
  // CONFIGURATION LOADING AND VALIDATION
  // =============================================================================

  /**
   * Loads and validates configuration from file
   */
  private loadConfig(configPath: string): ConfigType {
    const fullPath = this.findConfigFile(configPath);
    console.log(`Loading config from: ${fullPath}\n`);

    const content = fs.readFileSync(fullPath, "utf8");
    const config = yaml.load(content) as ConfigType;

    this.validateConfig(config);
    return config;
  }

  /**
   * Validates configuration structure
   */
  private validateConfig(config: ConfigType): void {
    if (!config.groups || !Array.isArray(config.groups)) {
      throw new Error("Invalid configuration: groups must be an array");
    }

    if (!config.selection_rules) {
      throw new Error(
        "Invalid configuration: selection_rules must be provided",
      );
    }

    for (const group of config.groups) {
      if (!group.name || !Array.isArray(group.usernames)) {
        throw new Error(`Invalid group configuration: ${group.name}`);
      }
    }

    // Check for potential duplicate selections
    this.checkForDuplicateSelections(config);
  }

  /**
   * Checks for potential duplicate selections in rules
   */
  private checkForDuplicateSelections(config: ConfigType): void {
    const groupNames = config.groups.map((g) => g.name);

    // Check each selection rule
    if (config.selection_rules?.by_author_group) {
      for (const rule of config.selection_rules.by_author_group) {
        const duplicateWarnings = this.checkRuleForDuplicates(
          rule.from,
          groupNames,
          `by_author_group[${rule.group}]`,
        );
        this.configWarnings.push(...duplicateWarnings);
      }
    }

    if (config.selection_rules?.default) {
      const duplicateWarnings = this.checkRuleForDuplicates(
        config.selection_rules.default.from,
        groupNames,
        "default",
      );
      this.configWarnings.push(...duplicateWarnings);
    }

    if (config.selection_rules?.non_group_members) {
      const duplicateWarnings = this.checkRuleForDuplicates(
        config.selection_rules.non_group_members.from,
        groupNames,
        "non_group_members",
      );
      this.configWarnings.push(...duplicateWarnings);
    }
  }

  /**
   * Checks a single rule for potential duplicates
   */
  private checkRuleForDuplicates(
    fromClause: Record<string, number>,
    groupNames: string[],
    ruleName: string,
  ): string[] {
    const warnings: string[] = [];
    const selectors = Object.keys(fromClause);

    // Check for wildcard (*) with other selectors
    if (selectors.includes("*") && selectors.length > 1) {
      const otherSelectors = selectors.filter((s) => s !== "*");
      const coloredSelectors = otherSelectors
        .map((s) => this.colorizeGroupName(s))
        .join(", ");
      const coloredRuleName = this.colorizeRuleName(ruleName);
      const coloredWildcard = this.colorize('"*"', "group");
      const warningIcon = this.colorize("⚠", "warning");
      warnings.push(
        `${warningIcon} In ${coloredRuleName}: Wildcard selector ${coloredWildcard} is used with other selectors (${coloredSelectors}). This may cause duplicate selections as ${coloredWildcard} includes all groups.`,
      );
    }

    // Check for exclusion patterns with explicit groups
    for (const selector of selectors) {
      if (selector.startsWith("!")) {
        const excludedGroup = selector.substring(1);
        const explicitGroups = selectors.filter(
          (s) => !s.startsWith("!") && s !== "*",
        );

        // Check if any explicit groups are specified
        if (explicitGroups.length > 0) {
          // Get all groups that would be included by the exclusion
          const includedByExclusion = groupNames.filter(
            (g) => g !== excludedGroup,
          );
          const overlappingGroups = explicitGroups.filter((g) =>
            includedByExclusion.includes(g),
          );

          if (overlappingGroups.length > 0) {
            const coloredOverlapping = overlappingGroups
              .map((g) => this.colorize(g, "group"))
              .join(", ");
            const coloredRuleName = this.colorizeRuleName(ruleName);
            const coloredSelector = this.colorize(`"${selector}"`, "group");
            const warningIcon = this.colorize("⚠", "warning");
            warnings.push(
              `${warningIcon} In ${coloredRuleName}: Exclusion pattern ${coloredSelector} overlaps with explicitly specified groups (${coloredOverlapping}). Members of ${coloredOverlapping} may be selected multiple times.`,
            );
          }
        }
      }
    }

    // Check for multiple exclusion patterns
    const exclusionPatterns = selectors.filter((s) => s.startsWith("!"));
    if (exclusionPatterns.length > 1) {
      const coloredPatterns = exclusionPatterns
        .map((p) => this.colorize(`"${p}"`, "group"))
        .join(", ");
      const coloredRuleName = this.colorizeRuleName(ruleName);
      const warningIcon = this.colorize("⚠", "warning");
      warnings.push(
        `${warningIcon} In ${coloredRuleName}: Multiple exclusion patterns found (${coloredPatterns}). Consider using explicit group names for clarity.`,
      );
    }

    return warnings;
  }

  /**
   * Colorizes a group name with quotes
   */
  private colorizeGroupName(groupName: string): string {
    return this.colorize(`"${groupName}"`, "group");
  }

  /**
   * Colorizes a rule name
   */
  private colorizeRuleName(ruleName: string): string {
    return this.colorize(ruleName, "group");
  }

  /**
   * Displays configuration warnings
   */
  private displayConfigWarnings(): void {
    if (this.configWarnings.length > 0) {
      console.log(this.colorize("\n⚠️  Configuration Warnings:", "warning"));
      console.log(this.colorize("━".repeat(60), "warning"));
      for (const warning of this.configWarnings) {
        console.log(`  ${warning}`);
      }
      console.log();
    }
  }

  /**
   * Finds configuration file path
   */
  private findConfigFile(configPath?: string): string {
    if (configPath) {
      return path.resolve(configPath);
    }

    const gitRoot = this.findGitRoot(process.cwd());
    if (!gitRoot) {
      throw new Error("Not in a git repository");
    }

    const defaultPath = path.join(gitRoot, ".github", "reviewer-lottery.yml");
    if (fs.existsSync(defaultPath)) {
      return defaultPath;
    }

    throw new Error("Configuration file not found");
  }

  /**
   * Finds git root directory
   */
  private findGitRoot(dir: string): string | null {
    const gitDir = path.join(dir, ".git");
    if (fs.existsSync(gitDir)) {
      return dir;
    }

    const parentDir = path.dirname(dir);
    if (parentDir === dir) {
      return null;
    }

    return this.findGitRoot(parentDir);
  }

  // =============================================================================
  // SCENARIO GENERATION
  // =============================================================================

  /**
   * Prints the main title
   */
  private printTitle(): void {
    console.log(
      this.colorize(
        `Reviewer Lottery Configuration Test (${this.simulationRuns} runs per scenario)\n`,
        "title",
      ),
    );
  }

  /**
   * Applies color formatting to text
   */
  private colorize(text: string, type: ColorType): string {
    if (!this.colorEnabled) {
      return text;
    }

    const colorMap: Record<ColorType, (text: string) => string> = {
      title: chalk.bold.blue,
      header: chalk.bold.cyan,
      group: chalk.bold.green,
      percentage: chalk.yellow,
      good: chalk.green,
      warn: chalk.yellow,
      warning: chalk.bold.yellow,
      error: chalk.red,
      info: chalk.gray,
    };

    return colorMap[type](text);
  }

  /**
   * Generates test scenarios for all possible author types
   */
  private generateScenarios(): TestScenario[] {
    const scenarios: TestScenario[] = [];
    const processedUsers = new Set<string>();
    const userGroupCount = this.buildUserGroupMapping();

    // Add scenarios for each group
    this.addGroupScenarios(scenarios, userGroupCount, processedUsers);

    // Add scenarios for multi-group users
    this.addMultiGroupScenarios(scenarios, userGroupCount);

    // Add external user scenario
    this.addExternalUserScenario(scenarios);

    return scenarios;
  }

  /**
   * Builds mapping of users to their groups
   */
  private buildUserGroupMapping(): Map<string, string[]> {
    const userGroupCount = new Map<string, string[]>();
    for (const group of this.config.groups) {
      for (const username of group.usernames) {
        if (!userGroupCount.has(username)) {
          userGroupCount.set(username, []);
        }
        userGroupCount.get(username)?.push(group.name);
      }
    }
    return userGroupCount;
  }

  /**
   * Adds scenarios for each group
   */
  private addGroupScenarios(
    scenarios: TestScenario[],
    userGroupCount: Map<string, string[]>,
    processedUsers: Set<string>,
  ): void {
    for (const group of this.config.groups) {
      const selectedUser = this.selectRepresentativeUser(
        group,
        userGroupCount,
        processedUsers,
      );
      if (selectedUser) {
        scenarios.push({
          id: `${group.name}-${selectedUser}`,
          author: selectedUser,
          authorGroup: group.name,
          description: `PR by ${selectedUser} (${group.name} member)`,
        });
        processedUsers.add(selectedUser);
      }
    }
  }

  /**
   * Adds scenarios for multi-group users
   */
  private addMultiGroupScenarios(
    scenarios: TestScenario[],
    userGroupCount: Map<string, string[]>,
  ): void {
    for (const [username, groups] of userGroupCount.entries()) {
      if (groups.length > 1) {
        scenarios.push({
          id: `multi-group-${username}`,
          author: username,
          authorGroup: groups[0],
          description: `PR by ${username} (member of ${groups.join(", ")})`,
        });
      }
    }
  }

  /**
   * Adds external user scenario
   */
  private addExternalUserScenario(scenarios: TestScenario[]): void {
    scenarios.push({
      id: "external-user",
      author: "external-user",
      authorGroup: null,
      description: "PR by external user (not in any group)",
    });
  }

  /**
   * Selects a representative user from a group
   */
  private selectRepresentativeUser(
    group: { name: string; usernames: string[] },
    userGroupCount: Map<string, string[]>,
    processedUsers: Set<string>,
  ): string | null {
    // First, try to find a user who belongs only to this group
    for (const username of group.usernames) {
      const groups = userGroupCount.get(username);
      if (groups && groups.length === 1 && !processedUsers.has(username)) {
        return username;
      }
    }

    // If no single-group user found, select any user not yet processed
    for (const username of group.usernames) {
      if (!processedUsers.has(username)) {
        return username;
      }
    }

    return null;
  }

  // =============================================================================
  // SIMULATION EXECUTION
  // =============================================================================

  private async runScenarios(scenarios: TestScenario[]): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (const scenario of scenarios) {
      console.log(
        `Running ${this.simulationRuns} simulations for ${scenario.author}...`,
      );
      const scenarioResult = await this.runSingleScenario(scenario);
      results.push(scenarioResult);
    }

    return results;
  }

  private async runSingleScenario(scenario: TestScenario): Promise<TestResult> {
    const simulationResults: string[][] = [];
    const selectionCount = new Map<string, number>();
    const groupSelectionCount = new Map<string, Map<string, number>>();

    for (let i = 0; i < this.simulationRuns; i++) {
      const { selectedReviewers, selectionDetails } =
        await this.simulateReviewerSelection(scenario.author);
      simulationResults.push(selectedReviewers);

      this.updateSelectionCounts(
        selectedReviewers,
        selectionDetails,
        selectionCount,
        groupSelectionCount,
      );
    }

    const successRate =
      simulationResults.filter((r) => r.length > 0).length /
      this.simulationRuns;
    const mostSelected = this.getMostSelectedReviewers(selectionCount);

    return {
      scenario,
      results: simulationResults,
      statistics: {
        selectionCount,
        groupSelectionCount,
        successRate,
        mostSelected,
      },
    };
  }

  private updateSelectionCounts(
    selectedReviewers: string[],
    selectionDetails: Map<string, string>,
    selectionCount: Map<string, number>,
    groupSelectionCount: Map<string, Map<string, number>>,
  ): void {
    for (const reviewer of selectedReviewers) {
      selectionCount.set(reviewer, (selectionCount.get(reviewer) || 0) + 1);

      const selectedAsGroup = selectionDetails.get(reviewer) || "unknown";
      if (!groupSelectionCount.has(selectedAsGroup)) {
        groupSelectionCount.set(selectedAsGroup, new Map());
      }
      const groupMap = groupSelectionCount.get(selectedAsGroup);
      if (groupMap) {
        groupMap.set(reviewer, (groupMap.get(reviewer) || 0) + 1);
      }
    }
  }

  private async simulateReviewerSelection(
    author: string,
  ): Promise<ReviewerSelection> {
    const result = this.reviewerSelector.selectReviewers(author, []);

    const selectionDetails = new Map<string, string>();
    for (const step of result.process) {
      for (const selectedReviewer of step.selected) {
        selectionDetails.set(selectedReviewer, step.groupKey);
      }
    }

    return {
      selectedReviewers: result.selectedReviewers,
      selectionDetails,
    };
  }

  private getMostSelectedReviewers(
    selectionCount: Map<string, number>,
  ): string[] {
    if (selectionCount.size === 0) return [];

    const maxCount = Math.max(...selectionCount.values());
    return Array.from(selectionCount.entries())
      .filter(([_, count]) => count === maxCount)
      .map(([reviewer, _]) => reviewer);
  }

  private displayConfigSummary(): void {
    const totalMembers = this.config.groups.reduce(
      (sum, g) => sum + g.usernames.length,
      0,
    );

    console.log(this.colorize("Configuration Summary:", "header"));
    console.log(this.colorize("━".repeat(60), "info"));
    console.log(
      this.colorize(
        `Groups (${this.config.groups.length} groups, ${totalMembers} total members):`,
        "info",
      ),
    );

    for (const group of this.config.groups) {
      console.log(
        `  └─ ${this.colorize(group.name.padEnd(12), "group")} : ${group.usernames.length} members (${group.usernames.join(", ")})`,
      );
    }

    console.log(this.colorize("\nSelection Rules:", "header"));
    if (this.config.selection_rules?.default) {
      console.log(
        "  └─ default:",
        JSON.stringify(this.config.selection_rules.default.from),
      );
    }
    if (this.config.selection_rules?.by_author_group) {
      for (const rule of this.config.selection_rules.by_author_group) {
        console.log(
          `  └─ ${this.colorize(rule.group, "group")}:`,
          JSON.stringify(rule.from),
        );
      }
    }
    if (this.config.selection_rules?.non_group_members) {
      console.log(
        "  └─ non_group_members:",
        JSON.stringify(this.config.selection_rules.non_group_members.from),
      );
    }
    console.log();
  }

  private displayResults(results: TestResult[]): void {
    console.log(this.colorize("\nSimulation Results:", "header"));
    console.log(this.colorize("━".repeat(80), "info"));

    const groupedResults = this.groupResultsByAuthorGroup(results);

    for (const [groupName, groupResults] of groupedResults) {
      this.displayGroupResults(groupName, groupResults);
    }

    this.displaySummary(results);
  }

  private displayGroupResults(
    groupName: string,
    groupResults: TestResult[],
  ): void {
    console.log(`\n${this.colorize(groupName, "group")}:`);
    console.log(this.colorize("─".repeat(80), "info"));

    const firstResult = groupResults[0];
    if (firstResult) {
      const rule = this.getSelectionRuleForAuthor(
        firstResult.scenario.author,
        firstResult.scenario.authorGroup,
      );
      console.log(`  Applied Rule:${rule}`);

      // Show actual selection outcome
      const actualOutcome = this.getActualSelectionOutcome(firstResult);
      if (actualOutcome) {
        console.log(`  Actual Outcome:${actualOutcome}`);
      }
      console.log();
    }

    for (const result of groupResults) {
      this.displayAuthorResults(result);
    }
  }

  private displayAuthorResults(result: TestResult): void {
    const groups = this.getUserGroups(result.scenario.author);
    const groupInfo = groups.length > 1 ? ` (${groups.join(", ")})` : "";
    console.log(`\n  ${result.scenario.author}${groupInfo}:`);
    console.log(`    Selection Distribution:`);

    const { selectionsByGroup } = this.processGroupSelectionData(result);

    const sortedGroups = this.sortGroupsByRuleOrder(
      Array.from(selectionsByGroup.keys()),
      result.scenario.author,
      result.scenario.authorGroup,
    );

    for (const groupKey of sortedGroups) {
      this.displayGroupSelections(
        groupKey,
        selectionsByGroup.get(groupKey) || [],
      );
    }
  }

  private processGroupSelectionData(result: TestResult): {
    selectionsByGroup: Map<string, SelectionData[]>;
    crossGroupMembers: Map<string, CrossGroupMemberInfo>;
  } {
    const selectionsByGroup = new Map<string, SelectionData[]>();
    const crossGroupMembers = new Map<string, CrossGroupMemberInfo>();

    for (const [
      groupKey,
      reviewerMap,
    ] of result.statistics.groupSelectionCount.entries()) {
      if (!selectionsByGroup.has(groupKey)) {
        selectionsByGroup.set(groupKey, []);
      }

      for (const [reviewer, count] of reviewerMap.entries()) {
        const reviewerGroups = this.getUserGroups(reviewer);

        selectionsByGroup.get(groupKey)?.push({
          reviewer,
          count,
          groups: reviewerGroups,
        });

        if (reviewerGroups.length > 1) {
          crossGroupMembers.set(reviewer, {
            count,
            groups: reviewerGroups,
            countedAsGroup: groupKey,
          });
        }
      }
    }

    return { selectionsByGroup, crossGroupMembers };
  }

  private displayGroupSelections(
    groupKey: string,
    selections: SelectionData[],
  ): void {
    if (!selections.length) return;

    selections.sort((a, b) => b.count - a.count);

    const groupTotalSelections = selections.reduce(
      (sum, s) => sum + s.count,
      0,
    );
    const groupPercentage = (
      (groupTotalSelections / this.simulationRuns) *
      100
    ).toFixed(1);

    console.log(
      `      ${this.colorize(groupKey, "group")} (${this.colorize(`${groupPercentage}%`, "percentage")}): ${groupTotalSelections}/${this.simulationRuns} selections`,
    );

    const maxUsernameLength = Math.min(
      Math.max(...selections.map((s) => s.reviewer.length)),
      15,
    );

    for (const selection of selections) {
      const percentage = (
        (selection.count / this.simulationRuns) *
        100
      ).toFixed(1);
      const paddedReviewer =
        selection.reviewer.length <= maxUsernameLength
          ? selection.reviewer.padEnd(maxUsernameLength)
          : selection.reviewer;

      const otherGroups = selection.groups.filter((g) => g !== groupKey);
      const multiGroupIndicator =
        otherGroups.length > 0 ? ` [also in ${otherGroups.join(", ")}]` : "";

      console.log(
        `        ${paddedReviewer}: ${selection.count}/${this.simulationRuns} (${this.colorize(`${percentage}%`, "percentage")})${multiGroupIndicator}`,
      );
    }
  }

  private getActualSelectionOutcome(result: TestResult): string {
    const groupCounts = new Map<string, number>();

    // Count total selections by group across all simulations
    for (const [
      groupKey,
      reviewerMap,
    ] of result.statistics.groupSelectionCount.entries()) {
      let groupTotal = 0;
      for (const count of reviewerMap.values()) {
        groupTotal += count;
      }
      groupCounts.set(groupKey, groupTotal);
    }

    if (groupCounts.size === 0) {
      return "\n    - No selections made";
    }

    // Skip showing actual outcome for non_group_members (always straightforward)
    if (!result.scenario.authorGroup) {
      return "";
    }

    // Get the applied rule to determine if we should show actual outcome
    const appliedRule = this.getApplicableRule(
      result.scenario.author,
      result.scenario.authorGroup,
    );

    // Skip showing actual outcome if:
    // 1. No rule is applicable
    // 2. Only one group type is involved in both rule and actual outcome
    if (!appliedRule || Object.keys(appliedRule).length === 0) {
      return "";
    }

    // Check if all selections are exactly as expected (no variance)
    const ruleGroupCount = Object.keys(appliedRule).length;
    const actualGroupCount = groupCounts.size;

    // If single group rule with single group outcome, don't show
    if (ruleGroupCount === 1 && actualGroupCount === 1) {
      return "";
    }

    // If all groups have exactly the expected count with 100% success rate, don't show
    let allGroupsExactMatch = true;
    for (const [groupKey, expectedCount] of Object.entries(appliedRule)) {
      const actualCount = groupCounts.get(groupKey) || 0;
      const expectedTotal = expectedCount * this.simulationRuns;
      if (actualCount !== expectedTotal) {
        allGroupsExactMatch = false;
        break;
      }
    }

    if (allGroupsExactMatch && groupCounts.size === ruleGroupCount) {
      return "";
    }

    // For multi-group authors, don't show actual outcome (it's redundant with merged rule)
    const authorGroups = this.getUserGroups(result.scenario.author);
    if (authorGroups.length > 1) {
      return "";
    }

    // Calculate average selections per group
    const parts: string[] = [];
    const sortedGroups = Array.from(groupCounts.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );

    for (const [groupKey, totalCount] of sortedGroups) {
      const avgSelections = (totalCount / this.simulationRuns).toFixed(1);
      const percentage = ((totalCount / this.simulationRuns) * 100).toFixed(1);
      parts.push(
        `    - ${avgSelections} reviewers from ${groupKey} (${percentage}% of simulations)`,
      );
    }

    return `\n${parts.join("\n")}`;
  }

  private displaySummary(results: TestResult[]): void {
    const totalScenarios = results.length;

    console.log(this.colorize("\nOverall Summary:", "header"));
    console.log(this.colorize("━".repeat(80), "info"));
    console.log(
      `Total scenarios tested: ${this.colorize(totalScenarios.toString(), "good")}`,
    );
    console.log(
      `Simulation runs per scenario: ${this.colorize(this.simulationRuns.toString(), "good")}`,
    );
    console.log(
      `Total simulations executed: ${this.colorize((totalScenarios * this.simulationRuns).toString(), "good")}`,
    );
  }

  private groupResultsByAuthorGroup(
    results: TestResult[],
  ): Map<string, TestResult[]> {
    const grouped = new Map<string, TestResult[]>();

    for (const result of results) {
      // Get all groups this author belongs to
      const authorGroups = this.getUserGroups(result.scenario.author);

      let groupName: string;
      if (authorGroups.length === 0) {
        groupName = "non_group_members";
      } else if (authorGroups.length === 1) {
        groupName = `[${authorGroups[0]}] Authors`;
      } else {
        // Multiple groups - show as combined group
        groupName = `[${authorGroups.join(" + ")}] Authors`;
      }

      if (!grouped.has(groupName)) {
        grouped.set(groupName, []);
      }
      grouped.get(groupName)?.push(result);
    }

    return grouped;
  }

  private getSelectionRuleForAuthor(
    author: string,
    authorGroup: string | null,
  ): string {
    if (!this.config.selection_rules) {
      return "No selection rules configured";
    }

    // Get all groups for the author
    const authorGroups = this.getUserGroups(author);

    // Multi-group author - show merged rule
    if (authorGroups.length > 1) {
      const mergedRule: Record<string, number> = {};
      const individualRules: Array<{
        group: string;
        rule: Record<string, number>;
      }> = [];

      // Collect rules from all groups
      for (const groupName of authorGroups) {
        const groupRule = this.config.selection_rules.by_author_group?.find(
          (rule) => rule.group === groupName,
        );
        const fromClause =
          groupRule?.from || this.config.selection_rules.default?.from;

        if (fromClause) {
          individualRules.push({ group: groupName, rule: fromClause });

          // Merge rules
          for (const [targetGroup, count] of Object.entries(fromClause)) {
            mergedRule[targetGroup] = Math.max(
              mergedRule[targetGroup] || 0,
              count,
            );
          }
        }
      }

      if (individualRules.length > 0) {
        let result = "";

        // Show individual rules
        for (const { group, rule } of individualRules) {
          result += `\n    ${group} Rule:${this.formatSelectionRule(rule)}`;
        }

        // Show merged rule
        result += `\n\n    Merged Rule:${this.formatSelectionRule(mergedRule)}`;

        return result;
      }
    }

    // Single group author - existing logic
    if (authorGroup && this.config.selection_rules.by_author_group) {
      const groupRule = this.config.selection_rules.by_author_group.find(
        (rule) => rule.group === authorGroup,
      );
      if (groupRule?.from) {
        return this.formatSelectionRule(groupRule.from);
      }
    }

    // Check non_group_members rule
    if (!authorGroup && this.config.selection_rules.non_group_members) {
      return this.formatSelectionRule(
        this.config.selection_rules.non_group_members.from,
      );
    }

    // Fall back to default rule
    if (this.config.selection_rules.default?.from) {
      return this.formatSelectionRule(this.config.selection_rules.default.from);
    }

    return "No applicable rule found";
  }

  private formatSelectionRule(rule: Record<string, number>): string {
    if (!rule || Object.keys(rule).length === 0) {
      return "\n    - No rule specified";
    }

    const parts: string[] = [];

    for (const [group, count] of Object.entries(rule)) {
      if (group === "*") {
        parts.push(
          `    - ${count} reviewer${count > 1 ? "s" : ""} from any group`,
        );
      } else if (group.startsWith("!")) {
        parts.push(
          `    - ${count} reviewer${count > 1 ? "s" : ""} from groups except ${group.substring(1)}`,
        );
      } else {
        parts.push(
          `    - ${count} reviewer${count > 1 ? "s" : ""} from ${group}`,
        );
      }
    }

    return `\n${parts.join("\n")}`;
  }

  private getUserGroups(username: string): string[] {
    return this.reviewerSelector.getAuthorGroups(username);
  }

  private sortGroupsByRuleOrder(
    groups: string[],
    author: string,
    authorGroup: string | null,
  ): string[] {
    // Get the applicable rule
    const rule = this.getApplicableRule(author, authorGroup);
    if (!rule) {
      return groups.sort(); // Fallback to alphabetical if no rule
    }

    // Create order based on rule definition
    const ruleOrder = Object.keys(rule);

    // Sort groups based on their position in the rule, with unknown groups at the end
    return groups.sort((a, b) => {
      const aIndex = ruleOrder.indexOf(a);
      const bIndex = ruleOrder.indexOf(b);

      // If both are in the rule, sort by rule order
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }

      // If only one is in the rule, prioritize it
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;

      // If neither is in the rule, sort alphabetically
      return a.localeCompare(b);
    });
  }

  private getApplicableRule(
    _author: string,
    authorGroup: string | null,
  ): Record<string, number> | null {
    if (!this.config.selection_rules) {
      return null;
    }

    // Check by_author_group rules
    if (authorGroup && this.config.selection_rules.by_author_group) {
      const groupRule = this.config.selection_rules.by_author_group.find(
        (rule) => rule.group === authorGroup,
      );
      if (groupRule?.from) {
        return groupRule.from;
      }
    }

    // Check non_group_members rule
    if (!authorGroup && this.config.selection_rules.non_group_members) {
      return this.config.selection_rules.non_group_members.from;
    }

    // Fall back to default rule
    if (this.config.selection_rules.default?.from) {
      return this.config.selection_rules.default.from;
    }

    return null;
  }
}

// =============================================================================
// CLI FUNCTIONALITY
// =============================================================================

/**
 * Parses command line arguments
 */
function parseCliArgs(): CliOptions {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  const options: CliOptions = {
    configPath: "",
    simulationRuns: 1000,
    colorEnabled: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--runs" || arg === "-r") {
      const runsValue = args[i + 1];
      if (runsValue && !Number.isNaN(Number(runsValue))) {
        options.simulationRuns = Number(runsValue);
        i++;
      } else {
        console.error("Error: --runs requires a numeric value");
        process.exit(1);
      }
    } else if (arg === "--no-color") {
      options.colorEnabled = false;
    } else if (arg === "--color") {
      options.colorEnabled = true;
    } else if (!arg.startsWith("-")) {
      options.configPath = arg;
    }
  }

  return options;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const options = parseCliArgs();
    const tester = new ConfigTester(
      options.configPath || "",
      options.simulationRuns,
      options.colorEnabled,
    );
    await tester.run();
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

/**
 * Shows help information
 */
function showHelp(): void {
  console.log(`
Reviewer Lottery Configuration Test

Usage:
  config-test.ts [config-path] [options]

Arguments:
  config-path    Path to the configuration file
                 (default: .github/reviewer-lottery.yml)

Options:
  --runs, -r     Number of simulation runs per scenario (default: 1000)
  --color        Enable colored output (default: enabled)
  --no-color     Disable colored output
  --help, -h     Show this help message

Description:
  Tests the reviewer lottery configuration by running actual lottery simulations
  multiple times for each scenario. Displays configuration summary, statistical
  analysis of reviewer selection, and success rates.

Examples:
  config-test.ts
  config-test.ts .github/reviewer-lottery.yml
  config-test.ts --runs 100    # Quick test
  config-test.ts --runs 10000  # High precision
  config-test.ts .github/reviewer-lottery.yml --runs 500
  config-test.ts --no-color    # Disable colors
  config-test.ts --help
`);
}

// =============================================================================
// SCRIPT EXECUTION
// =============================================================================

if (require.main === module) {
  main();
}
