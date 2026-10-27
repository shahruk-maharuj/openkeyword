# OpenKeyword

**Free, self-hosted keyword research.** Real data from Google, your own API keys, no monthly subscription.

Semrush and Ahrefs cost $100+ a month, mostly for data you could pull yourself. OpenKeyword pulls it for you: type a seed keyword and get hundreds of long-tail ideas grouped by search intent and topic, ready to export.

> 🚧 **Early but working.** Keyword ideas, intent and clusters work with no keys at all. Add Google Ads API keys to get real search volume, CPC and competition from Keyword Planner. See the [roadmap](ROADMAP.md).

## What it does

- **Hundreds of keyword ideas per seed** from Google Autocomplete: the seed, A–Z expansions, question keywords (*how, what, why, best…*) and modifiers (*near me, vs, price, free…*)
- **Search intent** for every keyword: informational, commercial, transactional or navigational
- **Topic clusters** so you can see which page each group of keywords belongs on
- **Country and language targeting** (US, UK, Canada, UAE, India, Bangladesh and more)
- **Filter and export to CSV**
- **Pluggable data sources.** Every source is one file in `src/lib/providers/`, so adding Bing, YouTube or Amazon suggestions is a small PR.

## Data sources

| Source | Gives you | Needs | Status |
|---|---|---|---|
| Google Autocomplete | Keyword ideas | Nothing | ✅ Working |
| Google Keyword Planner | Search volume, CPC, competition | Google Ads API keys (free) | ✅ Working |
| Google Trends | Trend over time, rising terms | Nothing | 🔜 Planned |
| Google Search Console | Your real clicks, impressions, rankings | Google OAuth | 🔜 Planned |
| DataForSEO | Competitor keywords, difficulty | Paid API (pay per use) | 🔜 Planned |
| OpenAI / Claude | Smarter clustering and intent | Your API key | 🔜 Planned |

Keyless sources always work. Each key you add unlocks more real data.

## Quick start

```bash
git clone https://github.com/shahruk-maharuj/openkeyword
cd openkeyword
npm install
npm run dev
```

Open http://localhost:3000.

Or with Docker:

```bash
docker build -t openkeyword .
docker run -p 3000:3000 --env-file .env openkeyword
```

## Configuration

Copy `.env.example` to `.env` and fill in only the sources you want. Anything left blank is skipped.

### Google Keyword Planner

1. Create a Google Ads account (no need to run ads) and apply for a [developer token](https://developers.google.com/google-ads/api/docs/get-started/dev-token). Basic or Explorer access is enough.
2. Create an OAuth client in Google Cloud and generate a refresh token with the `https://www.googleapis.com/auth/adwords` scope ([guide](https://developers.google.com/google-ads/api/docs/oauth/overview)).
3. Fill in the `GOOGLE_ADS_*` variables. `GOOGLE_ADS_CUSTOMER_ID` is the 10-digit account ID (dashes are fine). Set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` only if you sign in through a manager account.

Volume and CPC are fetched in one batched call per search, for the selected country and language. If the keys are wrong or Google is unavailable, OpenKeyword logs a warning and still shows keyword ideas.

## API

```
GET /api/research?q=roof+repair&country=us&lang=en
GET /api/providers
```

`/api/research` returns every keyword with its intent, cluster, word count, sources and, with Google Ads keys, volume, CPC and competition.

## Add a data source

Implement the `Provider` interface in `src/lib/types.ts`:

```ts
export const myProvider: Provider = {
  id: "my-source",
  name: "My Source",
  requiredEnv: ["MY_SOURCE_API_KEY"], // [] if it needs no keys
  async ideas(seed, { country, language }) { /* return KeywordIdea[] */ },
  async metrics(keywords, opts) { /* return Map<keyword, KeywordMetrics> */ },
};
```

Register it in `src/lib/research.ts`, add a test, and open a PR. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Fair use

OpenKeyword sends a few dozen autocomplete requests per search with low concurrency. Please don't use it for bulk scraping. For large volumes, connect the official Google Ads API instead.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Vitest

## License

MIT © [Shahruk Maharuj](https://github.com/shahruk-maharuj)
