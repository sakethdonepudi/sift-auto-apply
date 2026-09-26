# SIFT — Easy Apply Assistant

SIFT is a Manifest V3 Chrome extension for user-started LinkedIn Easy Apply runs. It searches a chosen role and location, filters visible results, fills supported questions with locally saved answers, uploads a saved PDF resume, and records only confirmed submissions.

## Install for local testing

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `extension` directory.
5. Pin SIFT, open **Setup resume & answers**, and save a PDF plus truthful answers.
6. Stay signed in to LinkedIn, open the popup, and press **Start run**.

## Reliability and safety behavior

- Search pagination moves in LinkedIn's 25-result batches.
- Job IDs are remembered so a run does not process the same card twice.
- Title, excluded terms, and location are checked before Easy Apply opens.
- A form is counted only after LinkedIn shows a submission confirmation or Applied state.
- Unsupported required fields cause a safe skip instead of a guessed answer.
- CAPTCHA, verification, login, and checkpoint pages stop the run.
- Submission and scan limits are configurable, and **Stop safely** ends the run.
- Resume and answers stay in local Chrome extension storage; SIFT has no backend.

LinkedIn changes its interface regularly, so selectors require ongoing testing. Automated activity may be limited by LinkedIn and may be governed by its terms. SIFT does not bypass security checks and cannot guarantee support for every employer form.

## Package

From the repository root:

```sh
./scripts/package-extension.sh
```

This validates JavaScript and the manifest, packages only the runtime files, verifies the ZIP, and writes `dist/sift-auto-apply-v<version>.zip`.
