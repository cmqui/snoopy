# Snoopy

Open-source Gmail tracking MVP for a small allowlisted set of users.

## Repository layout

- `packages/backend`: Cloud Run API and tracking pixel service.
- `packages/addon`: Google Apps Script Gmail add-on.

## Add-on CI

The repo includes a GitHub Actions workflow at `.github/workflows/deploy-addon.yml` that can push the Gmail add-on to an Apps Script project using `clasp`.

Required GitHub secrets:

- `CLASP_AUTH_JSON`: the contents of `~/.clasprc.json` from a successful `clasp login`
- `APPS_SCRIPT_ID`: the target Apps Script project ID

This workflow is best used for a dev Apps Script project, not production.

## Important limitation

Gmail messages share one HTML body across all recipients. That means a standard tracking pixel cannot reliably attribute an open to a specific recipient when a single email is sent to multiple people. This repository still models recipients individually and stores per-recipient tokens, but accurate attribution requires one recipient per sent message.

Gmail also proxies remote images, so logged IPs may be Google proxy IPs rather than the recipient's endpoint.

## Quick start

```bash
npm install
npm run build
npm test
```

See the package READMEs for backend and add-on setup.
