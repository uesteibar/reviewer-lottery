import fs from "node:fs";
import * as core from "@actions/core";
import yaml from "js-yaml";

interface Group {
  name: string;
  usernames: string[];
}

interface SelectionRule {
  group: string;
  from: Record<string, number>;
}

interface SelectionRules {
  default?: {
    from: Record<string, number>;
  };
  by_author_group?: SelectionRule[];
  non_group_members?: {
    from: Record<string, number>;
  };
}

export interface Config {
  groups: Group[];
  selection_rules?: SelectionRules;
  when_author_in_multiple_groups?: "merge" | "first";
}

export const getConfig = (): Config => {
  const configPath = core.getInput("config", { required: true });

  try {
    const config = yaml.load(fs.readFileSync(configPath, "utf8")) as Config;

    // Validate configuration
    validateConfig(config);

    return config;
  } catch (error: unknown) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }

  return { groups: [] };
};

const validateConfig = (config: Config): void => {
  // Require selection_rules
  if (!config.selection_rules) {
    throw new Error("`selection_rules` must be provided in the configuration");
  }

  // Validate selection_rules
  validateSelectionRules(config.selection_rules, config.groups);

  // Validate when_author_in_multiple_groups
  if (config.when_author_in_multiple_groups) {
    const validStrategies = ["merge", "first"];
    if (!validStrategies.includes(config.when_author_in_multiple_groups)) {
      throw new Error(
        `Invalid value for 'when_author_in_multiple_groups': '${config.when_author_in_multiple_groups}'. Must be one of: ${validStrategies.join(", ")}`,
      );
    }
  }
};

const validateSelectionRules = (
  rules: SelectionRules,
  groups: Group[],
): void => {
  const groupNames = groups.map((g) => g.name);

  // Validate default rule
  if (rules.default) {
    validateFromClause(rules.default.from, groupNames);
  }

  // Validate by_author_group rules
  if (rules.by_author_group) {
    for (const rule of rules.by_author_group) {
      // Validate group exists
      if (!groupNames.includes(rule.group)) {
        throw new Error(
          `Group '${rule.group}' in selection_rules does not exist`,
        );
      }

      // Validate from clause
      validateFromClause(rule.from, groupNames);
    }
  }

  // Validate non_group_members rule
  if (rules.non_group_members) {
    validateFromClause(rules.non_group_members.from, groupNames);
  }
};

const validateFromClause = (
  from: Record<string, number>,
  groupNames: string[],
): void => {
  for (const [key, count] of Object.entries(from)) {
    if (count < 0) {
      throw new Error(
        `Reviewer count must be non-negative, got ${count} for '${key}'`,
      );
    }

    // Validate group references (skip special keywords)
    if (key !== "*" && !key.startsWith("!")) {
      if (!groupNames.includes(key)) {
        throw new Error(`Group '${key}' in selection rule does not exist`);
      }
    }

    // Validate !groupname syntax (support comma-separated list)
    if (key.startsWith("!")) {
      const excludeGroups = key
        .substring(1)
        .split(",")
        .map((g) => g.trim());
      for (const excludeGroup of excludeGroups) {
        if (!groupNames.includes(excludeGroup)) {
          throw new Error(
            `Group '${excludeGroup}' in exclusion rule '${key}' does not exist`,
          );
        }
      }
    }
  }
};
