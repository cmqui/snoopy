# Gmail Add-on

Google Apps Script Gmail add-on for tracked compose and reporting.

## Setup

1. Create a Google Apps Script project.
2. Copy `appsscript.json` and `src/Code.js` into the project.
3. Set script properties:
   - `SNOOPY_API_BASE_URL`
   - `SNOOPY_SHARED_SECRET` (optional if you later add shared-secret middleware)
4. Add the OAuth scopes from `appsscript.json`.
5. Deploy as a Google Workspace add-on test deployment.

## Local `clasp` setup

`clasp` is the most convenient way to keep this project in Git and push changes to Apps Script.

1. Install `clasp`:

```bash
npm install -g @google/clasp
```

2. Enable the Apps Script API for your Google account:
https://script.google.com/home/usersettings

3. Log in:

```bash
clasp login
```

4. Create a local config from the example:

```bash
cp .clasp.json.example .clasp.json
```

5. Replace `scriptId` in `.clasp.json` with your Apps Script project ID.

6. Push the add-on files:

```bash
clasp push --force
```

The checked-in `.claspignore` already limits the push to `appsscript.json` and `src/Code.js`.

## GitHub Actions CI deployment

This repo includes `.github/workflows/deploy-addon.yml`, which pushes `packages/addon` to Apps Script on every push to `main` that changes add-on files.

Required GitHub repository secrets:

- `CLASP_AUTH_JSON`
  - The full contents of your local `~/.clasprc.json` created by `clasp login`.
- `APPS_SCRIPT_ID`
  - The Apps Script project ID for your dev add-on project.

Recommended setup:

- Use one Apps Script project for dev CI pushes.
- Keep production as a separate Apps Script project and deploy to it manually.

## Notes

- The add-on uses `ScriptApp.getIdentityToken()` to authenticate the current Google user to the backend.
- The compose UI warns about Gmail image proxying and multi-recipient attribution limits.
