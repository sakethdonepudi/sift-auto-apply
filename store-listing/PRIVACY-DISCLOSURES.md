# Chrome Web Store privacy disclosures

## Single purpose

SIFT helps a user search matching LinkedIn jobs and complete LinkedIn Easy Apply applications with a locally saved resume and truthful saved answers after the user explicitly starts a run.

## Permission justifications

- `storage`: Saves the user's setup, PDF resume, custom answers, run progress, and already-submitted job IDs locally on the device.
- `alarms`: Runs a watchdog that stops an active run when the LinkedIn tab has not responded for two minutes.
- `https://*.linkedin.com/*`: Reads visible LinkedIn job cards and Easy Apply form fields, clicks Easy Apply controls, fills supported answers, uploads the selected resume, and confirms submission. The extension does not run on unrelated websites.

## Data-use certification

SIFT has no developer-operated backend, analytics, ads, remote code, or data sale. User-entered profile and resume data is stored locally. During a user-started run, selected data is inserted into LinkedIn forms and is therefore transmitted to LinkedIn as necessary to provide the extension's single purpose.

Disclose the handling of:

- personally identifiable information (name, email, phone, location, profile links);
- authentication-related employment answers (work authorization and sponsorship, but not passwords);
- website content and user activity on LinkedIn job and Easy Apply pages;
- resume and employment/application information.

The developer does not collect or receive this information. It is locally stored and shared with LinkedIn only to complete the user-requested application workflow.
