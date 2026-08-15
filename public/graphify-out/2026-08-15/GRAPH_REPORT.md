# Graph Report - epresensi jateng  (2026-08-15)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 280 nodes · 332 edges · 9 communities (6 shown, 3 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `79260352`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- app.js
- server.js
- dependencies
- escapeHtml
- manifest.json
- loadConfig
- applyTheme
- loadStatus
- sw.js

## God Nodes (most connected - your core abstractions)
1. `fetch` - 8 edges
2. `loadConfig()` - 7 edges
3. `setupScheduler()` - 7 edges
4. `addLog()` - 6 edges
5. `ensureValidSession()` - 6 edges
6. `saveSessionAndReturn()` - 6 edges
7. `escapeHtml()` - 6 edges
8. `doLogin()` - 5 edges
9. `sendWhatsApp()` - 5 edges
10. `fetchColleaguesAttendance()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `formatWaHtml()` --calls--> `escapeHtml()`  [EXTRACTED]
  public/app.js → public/app.js  _Bridges community 3 → community 5_

## Import Cycles
- None detected.

## Communities (9 total, 3 thin omitted)

### Community 0 - "app.js"
Cohesion: 0.01
Nodes (162): addAccountFeedback, addRecipientForm, addRecipientModal, appGatekeeperScreen, AVATAR_GRADIENTS, batchCountBtn, batchCountTag, btnAddRecipientModal (+154 more)

### Community 1 - "server.js"
Cohesion: 0.07
Nodes (45): actionLimiter, addLog(), allowedOrigins, app, authLimiter, BAILEYS_AUTH_DIR, checkAttendance(), colleagueCache (+37 more)

### Community 2 - "dependencies"
Cohesion: 0.07
Nodes (26): cors, express, multer, node-cron, node-fetch, dependencies, cors, express (+18 more)

### Community 3 - "escapeHtml"
Cohesion: 0.15
Nodes (16): applyColleaguesData(), escapeHtml(), getTeacherAvatar(), loadColleagues(), loadLogs(), loadRecipients(), loadSchoolAccounts(), performCheck() (+8 more)

### Community 4 - "manifest.json"
Cohesion: 0.22
Nodes (8): background_color, description, display, icons, name, short_name, start_url, theme_color

### Community 5 - "loadConfig"
Cohesion: 0.40
Nodes (5): formatWaHtml(), loadConfig(), loadWaStatus(), switchWaGatewayUI(), updateMessagePreviews()

## Knowledge Gaps
- **210 isolated node(s):** `addAccountFeedback`, `addRecipientForm`, `addRecipientModal`, `appGatekeeperScreen`, `AVATAR_GRADIENTS` (+205 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `addAccountFeedback`, `addRecipientForm`, `addRecipientModal` to the rest of the system?**
  _210 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.011904761904761904 - nodes in this community are weakly interconnected._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06802721088435375 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._