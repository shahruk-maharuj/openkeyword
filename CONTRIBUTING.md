# Contributing

Thanks for helping. The easiest way in is a new **data source** (see "Add a data source" in the README) or an unticked item from [ROADMAP.md](ROADMAP.md).

1. Fork and create a branch.
2. `npm install`
3. Make your change with a test in `tests/`.
4. Make sure these pass:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

5. Open a pull request that explains what changed and why.

**Ground rules:** providers must fail soft (return nothing rather than throw), must not need keys unless `requiredEnv` says so, and should be polite to the services they call (low concurrency, caching).
