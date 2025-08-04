# Reviewer lottery (Github Action)

This is a github action to add automatic reviewer lottery to your pull requests.

Add your configuration on `.github/reviewer-lottery.yml`

```yaml
groups:
  - name: devs # name of the group
    reviewers: 2 # how many reviewers do you want to assign?
    internal_reviewers: 1 # how many reviewers do you want to assign when the PR author belongs to this group?
    usernames: # github usernames of the reviewers
      - uesteibar
      - tebs
      - rudeayelo
      - marciobarrios

  - name: qas # you can have multiple groups, it will evaluate them separately
    reviewers: 1
    usernames:
      - some_user
      - someoneelse
```

About `reviewers` and `internal_reviewers`: they can both be set, or only one of them, with the following behavior:
- Both set:
  - If the PR author belongs to the group, it will use `internal_reviewers`.
  - If the PR author doesn't belong to the group, it will use `reviewers`.
- Only `reviewer` set: it will always use `reviewer`, no matter if the PR author belongs to the group or not.
- Only `internal_reviewers` set:
  - If the PR author belongs to the group, it will use `internal_reviewers`.
  - If the PR author doesn't belong to the group, it won't assign any reviewer.

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

If you are a Github Enterprise user, you must provide a base url for your Github instance's API:

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
    - uses: omniplatypus/reviewer-lottery@v3.2.1
      with:
        repo-token: ${{ secrets.GITHUB_TOKEN }}
        base-url: https://git.yourcompany.com/api/v3
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
