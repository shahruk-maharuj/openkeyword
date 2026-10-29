# Roadmap

Work top to bottom. Each item is sized for one focused session: one pull request, with tests. Tick the box in the same PR that ships the item.

## Real data

- [ ] **Google Keyword Planner provider.** Use the Google Ads API REST `KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics` with an OAuth refresh token to exchange for an access token. Batch keywords (max 10,000 per call), map `avgMonthlySearches`, `lowTopOfPageBidMicros`, `highTopOfPageBidMicros` and `competitionIndex` into `KeywordMetrics`. Use country → geo target constants and language → language constants. Remove `planned: true`. Test with a mocked fetch.
- [ ] **Google Trends provider.** Interest over the last 12 months for the top 5 keywords, plus "rising" related queries as extra ideas. Unofficial endpoint, so cache it and fail soft.
- [x] **Trend sparkline** in the results table (inline SVG, no chart library).
- [ ] **Google Search Console provider.** OAuth or service account. Pull queries for a verified site with clicks, impressions, CTR and position. Add an "Opportunities" filter: impressions above 100 and position 8–20.
- [ ] **DataForSEO provider.** Competitor mode: enter a domain and get its ranked keywords (`dataforseo_labs/google/ranked_keywords/live`), plus keyword difficulty.

## Product

- [ ] **Response cache.** Cache autocomplete results per (query, country, language) for 24 hours, in memory with an optional file store, so repeat searches are instant and Google sees fewer requests.
- [ ] **Saved projects.** SQLite (`better-sqlite3`): save a search, reopen it, add notes, mark keywords as targeted.
- [ ] **Bulk mode.** Paste up to 1,000 keywords to get intent, clusters and (with keys) metrics for all of them.
- [ ] **AI clustering (optional).** With `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, group keywords into named topics and suggest a page title for each cluster.
- [ ] **YouTube and Amazon suggestion providers** (`ds=yt` and Amazon's completion endpoint).
- [ ] **Dark mode.**

## Distribution

- [ ] **CLI:** `npx openkeyword "roof repair" --country us --csv`.
- [ ] **CI workflow:** lint, typecheck, test and build on every PR.
- [ ] **Docker image** published to GitHub Container Registry on release.
- [ ] **One-click deploy** buttons for Vercel and Railway in the README.
- [ ] **Demo GIF** in the README, recorded from the real app.
