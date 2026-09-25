# SIFT

SIFT is a zero-noise, approval-controlled job search workspace. It enforces exact role and city matching before an opportunity can enter the pipeline.

Run python3 -m http.server 8080 and open http://localhost:8080.

The MVP includes resume selection, keyboard autocomplete for roles and locations, strict profile preferences, focused LinkedIn search links, manual job and post import, match scoring, tailored application/email/comment drafts, a mandatory review queue, CSV export, and browser-local persistence.

LinkedIn does not offer a general public API for automatically applying to arbitrary jobs or commenting on arbitrary posts. Scraping or unattended browser control can trigger account restrictions and create spam. SIFT uses exact user-initiated searches and approval-gated handoffs. A production version should add encrypted backend storage, robust resume extraction, LLM drafting, email OAuth, audit logs, and an approved jobs-data provider.

## Auto Apply companion

The extension directory contains an optional Chrome extension that performs the Easy Apply interaction requested by the user:

1. Open chrome://extensions.
2. Enable Developer mode and choose Load unpacked.
3. Select the extension directory in this project.
4. Open the extension settings and save a PDF resume and truthful application defaults.
5. Use Auto Apply in SIFT.

The companion opens an exact LinkedIn search, selects matching listings, clicks Easy Apply, uploads the resume, fills configured answers, and submits complete forms. It skips unknown required questions and stops on security checks. See extension/README.md for limitations.
