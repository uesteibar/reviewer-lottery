# Reviewer lottery (Github Action)

This is a github action to add automatic reviewer lottery to your pull requests.

Add your configuration on `.github/reviewer-lottery.yml`

## Configuration

The configuration uses `selection_rules` to provide maximum flexibility for reviewer assignment:

```yaml
groups:
  - name: backend
    usernames:
      - alice
      - bob
      - charlie
  - name: frontend
    usernames:
      - diana
      - eve
  - name: ops
    usernames:
      - frank
      - grace

selection_rules:
  # Default rules for authors not in any group or when no group-specific rule exists
  default:
    from:
      backend: 1      # 1 reviewer from backend team
      frontend: 2     # 2 reviewers from frontend team

  # Rules for authors who are not members of any group
  non_group_members:
    from:
      backend: 1      # 1 reviewer from backend team
      ops: 1          # 1 reviewer from ops team

  # Group-specific rules based on PR author's group membership
  by_author_group:
    - group: backend
      from:
        backend: 2    # 2 reviewers from same team
        frontend: 1   # 1 reviewer from frontend team
    
    - group: frontend
      from:
        "*": 2        # 2 reviewers from any group
    
    - group: ops
      from:
        ops: 2        # 2 reviewers from ops team
        "!ops": 1     # 1 reviewer from any team except ops
```

#### Priority Rules

When assigning reviewers, the following priority is used:

1. **For authors in a group**: Looks for matching rule in `by_author_group`, falls back to `default`
2. **For authors not in any group**: Uses `non_group_members` if defined, falls back to `default`
3. **No reviewers assigned**: If no `from` clause is found or is empty

#### Special Keywords

- **`"*"`** - Select from all groups
- **`"!groupname"`** - Select from all groups except the specified one

#### Examples

```yaml
# Example 1: Team members get internal + external review
- group: backend
  from:
    backend: 2      # 2 from same team
    frontend: 1     # 1 from frontend team

# Example 2: All groups participate
- group: frontend
  from:
    "*": 3          # 3 reviewers from any group

# Example 3: Exclude specific groups
- group: ops
  from:
    ops: 1          # 1 from ops team
    "!ops": 2       # 2 from any other team
```


The ideal workflow configuration is:

```yaml
name: "Reviewer lottery"
on:
  pull_request_target:
    types: [opened, ready_for_review, reopened]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v1
    - uses: uesteibar/reviewer-lottery@v3
      with:
        repo-token: ${{ secrets.GITHUB_TOKEN }}
```


When opening a PR, this github action will assign random reviewers:

![](./img/assignation_example.png)


## FAQ

**Why would I want to assign random reviewers?**

Code reviews are not only a great tool to improve code quality, but also to spread
shared code ownership and share knowledge. When developers are frequently reviewing
changes in the codebase, it's easier to stay up to date with the latest conventions,
patterns and decisions.

Plus, you always learn something new seeing how other people solve problems!


**Why adding users in the config file directly and not using a github team?**

This way, you can add and remove yourself from the lottery easily in case you go on vacation,
are not working on this repo for some time, etc.

Reviewing code is good and fun, but we want to be able to disconnect from time to time! :palm_tree: :sunny:

**Why on pull_request_target?**

By running this action on `pull_request_target` we enable this action to be performed on PRs opened by users with 
readonly access to the repo, for example those by Dependabot.
