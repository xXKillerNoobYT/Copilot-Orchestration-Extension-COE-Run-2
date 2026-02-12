# GitHub Issues Bi-Directional Sync

## Purpose
Synchronize GitHub Issues with COE's local task management system, enabling developers to manage issues from either GitHub or the COE dashboard.

## Configuration
Add to `.coe/config.json`:
```json
{
  "github": {
    "token": "ghp_...",
    "owner": "your-org",
    "repo": "your-repo",
    "syncIntervalMinutes": 5,
    "autoImport": false
  }
}
```

## Workflow

### Import Issues
1. `coe.importGitHubIssues` command triggers import
2. GitHubClient fetches all issues (paginated, 50 per page)
3. Each issue is upserted into `github_issues` table with checksums
4. Existing issues are updated; new issues are imported

### Convert Issue to Task
1. Select a GitHub issue in the web app or use the API
2. `convertIssueToTask()` maps:
   - Labels containing "p1", "critical", "urgent" → P1
   - Labels containing "p3", "low" → P3
   - Everything else → P2
3. Task title format: `[GH-{number}] {title}`
4. Task is linked to the GitHub issue via `task_id`

### Bidirectional Sync
1. First, import latest from GitHub (pull)
2. Find locally-modified issues (where `local_checksum != remote_checksum`)
3. Push local changes back to GitHub via API
4. Update checksums to match

### Checksum Algorithm
- MD5 hash of: `title|body|state|sorted_labels`
- Detects changes on either side

## Rate Limiting
- Tracks `X-RateLimit-Remaining` header
- Stops requests when remaining <= 5
- Shows reset time in error messages

## Edge Cases
- Network failures: logged to audit, error count returned
- Rate limit exceeded: throws with wait time
- Missing config: warns user to add configuration
