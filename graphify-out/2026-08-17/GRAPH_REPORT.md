# Graph Report - EPRESENSI-SINAGA  (2026-08-17)

## Corpus Check
- 13 files · ~253,570 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 363 nodes · 420 edges · 15 communities (8 shown, 7 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5ea49614`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- app.js
- server.js
- dependencies
- escapeHtml
- manifest.json
- ✨ Fitur Utama Aplikasi
- applyTheme
- loadStatus
- sw.js
- rules/graphify.md
- workflows/graphify.md
- deploy_vps.sh
- formatWaHtml
- template_daftar_guru_50673033.md

## God Nodes (most connected - your core abstractions)
1. `fetch` - 8 edges
2. `loadConfig()` - 8 edges
3. `runSchedulerLogic()` - 8 edges
4. `✨ Fitur Utama Aplikasi` - 8 edges
5. `escapeHtml()` - 7 edges
6. `addLog()` - 7 edges
7. `ensureValidSession()` - 7 edges
8. `showToast()` - 6 edges
9. `loadColleagues()` - 6 edges
10. `saveSessionAndReturn()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `formatWaHtml()` --calls--> `escapeHtml()`  [EXTRACTED]
  public/app.js → public/app.js  _Bridges community 13 → community 3_

## Import Cycles
- None detected.

## Communities (15 total, 7 thin omitted)

### Community 0 - "app.js"
Cohesion: 0.01
Nodes (194): activeDayPopup, addAccountFeedback, addRecipientForm, addRecipientModal, analyticsChartBody, appGatekeeperScreen, AVATAR_GRADIENTS, batchCountBtn (+186 more)

### Community 1 - "server.js"
Cohesion: 0.06
Nodes (48): actionLimiter, addLog(), allowedOrigins, app, AUTH_SECRET, authLimiter, BAILEYS_AUTH_DIR, checkAttendance() (+40 more)

### Community 2 - "dependencies"
Cohesion: 0.06
Nodes (30): cheerio, cors, dotenv, express, multer, node-cron, node-fetch, dependencies (+22 more)

### Community 3 - "escapeHtml"
Cohesion: 0.13
Nodes (20): applyColleaguesData(), buildDateStrip(), escapeHtml(), getTeacherAvatar(), loadColleagues(), loadLogs(), loadRecipients(), loadSchoolAccounts() (+12 more)

### Community 4 - "manifest.json"
Cohesion: 0.22
Nodes (8): background_color, description, display, icons, name, short_name, start_url, theme_color

### Community 5 - "✨ Fitur Utama Aplikasi"
Cohesion: 0.07
Nodes (27): 1. Unhandled Disconnect & Reconnect Lifecycle Crash, 2. Gateway Dispatcher Conflict ("Gagal kirim: Terjadi kesalahan"), 3. Normalisasi Format Nomor Telepon & JID WhatsApp, 4. Isolasi Kunci Sesi Kriptografi (.gitignore), 5. Pengendalian Noise Log (Pino Silent Logger), 🏗️ Arsitektur Integrasi Baileys, ⚠️ Masalah yang Dihadapi & Solusinya, 🛠️ Panduan Teknis & Troubleshooting: @whiskeysockets/baileys (+19 more)

### Community 13 - "formatWaHtml"
Cohesion: 0.40
Nodes (5): formatWaHtml(), loadConfig(), loadWaStatus(), switchWaGatewayUI(), updateMessagePreviews()

## Knowledge Gaps
- **272 isolated node(s):** `deploy_vps.sh script`, `name`, `version`, `description`, `main` (+267 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `deploy_vps.sh script`, `name`, `version` to the rest of the system?**
  _272 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.009950248756218905 - nodes in this community are weakly interconnected._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06386066763425254 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `escapeHtml` be split into smaller, more focused modules?**
  _Cohesion score 0.13157894736842105 - nodes in this community are weakly interconnected._
- **Should `✨ Fitur Utama Aplikasi` be split into smaller, more focused modules?**
  _Cohesion score 0.06896551724137931 - nodes in this community are weakly interconnected._