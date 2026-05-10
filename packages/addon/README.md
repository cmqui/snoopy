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

## Notes

- The add-on uses `ScriptApp.getIdentityToken()` to authenticate the current Google user to the backend.
- The compose UI warns about Gmail image proxying and multi-recipient attribution limits.
