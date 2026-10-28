# OpenKeyword

**Free, self-hosted keyword research.** Real data from Google, your own API keys, no monthly subscription.

Semrush and Ahrefs cost $100+ a month, mostly for data you could pull yourself. OpenKeyword pulls it for you: type a seed keyword and get hundreds of long-tail ideas grouped by search intent and topic, ready to export.

> 🚧 **Early but working.** Keyword ideas, intent and clusters work today with no keys at all. Real volume and CPC from Google Keyword Planner is next. See the [roadmap](ROADMAP.md).

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
| Google Keyword Planner | Search volume, CPC, competition | Google Ads API keys (free) | 🔜 Next |
| Google Trends | 12-month trend, rising terms | Nothing | ✅ Working (unofficial, best effort) |
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

### Google Trends

Needs no keys. For each search, OpenKeyword asks Google Trends for the 12-month interest of the top 5 keywords and adds the seed's "rising" related queries as extra ideas. Trends has no official API, so requests run one at a time, answers are cached for 24 hours, and if Google rate-limits or changes the format you simply get no trend data.

## API

```
GET /api/research?q=roof+repair&country=us&lang=en
GET /api/providers
```

`/api/research` returns every keyword with its intent, cluster, word count, sources and (once connected) volume and CPC.

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
