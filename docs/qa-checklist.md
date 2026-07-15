# QA Checklist — before every version tag + push to GitHub

Run every item below before creating a git tag and pushing a new version.
Do not skip steps because "it's a small change" — this is the only safety
net before code reaches the production server, since there is no automated
test suite yet (`npm test` is currently a placeholder).

## 1. Clean install & build

- [ ] `npm install` in the project root completes with no errors
- [ ] `npm run build-ui` (builds `sign-smart-quote/dist`) completes with no
      errors

## 2. Server boots cleanly

- [ ] `node src/server.js` starts with no errors
- [ ] Console log shows the DB connected and table/seed lines (`[db]`,
      `[signshop seed]`, `[auth seed]`) with no unexpected warnings
- [ ] `GET /api/version` returns the expected new version number

## 3. Smoke test the core flows

- [ ] Log in as each of: `admin`, `agent`, `אביתר`
- [ ] Run a quote through the main calculator and confirm the price/area
      breakdown looks correct
- [ ] Open the admin dashboard and confirm the pricing tree/tables load
- [ ] If the change touched quotes/notifications: send a quote for
      approval and confirm the manager sees a notification

## 4. Diff review (security + hygiene)

- [ ] `git diff <last-tag>..HEAD --stat` reviewed — no unexpected files
- [ ] Confirm `database.sqlite`, `.env`, any API keys/secrets are **not**
      staged (check `.gitignore` still covers them)
- [ ] `node_modules/` and `sign-smart-quote/dist/` are not staged

## 5. Version bump

- [ ] `package.json` `"version"` field updated to the new version
- [ ] `CHANGELOG.md` has a new entry describing what changed

## 6. Ship it

Only after every box above is checked:

```
git add -A
git commit -m "Release vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main --tags
```

Then run `deploy/UPDATE.ps1 -Version vX.Y.Z` on the production server.
