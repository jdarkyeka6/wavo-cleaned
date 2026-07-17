# Wavo iOS pipeline — finishing steps (do these once Paul's account is live)

The pipeline files are already in the repo. It can't run yet because the final
"upload to Apple" step needs credentials from Paul's Developer account. Here's
exactly what to grab and where to paste it. Nothing here needs a Mac.

## Where the files go in the repo

- `.github/workflows/ios-testflight.yml`  → repo root, in `.github/workflows/`
- `ios/App/fastlane/Fastfile`             → inside your `ios/App/` folder
- `ios/App/fastlane/Appfile`              → same place
- `ios/App/Gemfile`                       → inside `ios/App/`

Commit and push all of them.

## Step 1 — create the app record in App Store Connect

Once Paul's account is approved:
1. Go to appstoreconnect.apple.com → My Apps → "+" → New App.
2. Platform: iOS. Name: **Wavo**. Bundle ID: **lol.wavo.app**
   (if it's not in the dropdown, create it under Certificates, Identifiers &
   Profiles → Identifiers first).
3. Fill the basics (you can edit later).

## Step 2 — make an App Store Connect API key

1. appstoreconnect.apple.com → Users and Access → Integrations → App Store
   Connect API → "+" to create a key.
2. Name it "Wavo CI", role **App Manager**.
3. Download the **.p8 file** — you only get to download it ONCE, keep it safe.
4. Note the **Key ID** and the **Issuer ID** shown on that page.

## Step 3 — find the Team ID

- appstoreconnect.apple.com → Membership (or the top-right account menu).
  It's a 10-character code like `ABCDE12345`.

## Step 4 — add the four secrets to GitHub

In your repo: Settings → Secrets and variables → Actions → "New repository
secret". Add these four, named EXACTLY:

| Secret name        | What to paste                                             |
|--------------------|-----------------------------------------------------------|
| `ASC_KEY_ID`       | the Key ID from Step 2                                     |
| `ASC_ISSUER_ID`    | the Issuer ID from Step 2                                  |
| `APPLE_TEAM_ID`    | the Team ID from Step 3                                    |
| `ASC_KEY_CONTENT`  | the .p8 file contents, base64-encoded (see below)         |

To base64 the .p8 on Windows PowerShell:
```
[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXX.p8"))
```
Copy the whole output string into `ASC_KEY_CONTENT`.

## Step 5 — run it

Repo → Actions tab → "iOS → TestFlight" → "Run workflow".
Watch it build. First run often needs one small tweak (usually the scheme name
or a signing detail) — if it goes red, copy the failed step's log to Claude and
we'll fix it.

## Step 6 — TestFlight

When it goes green, the build appears in App Store Connect → TestFlight after a
few minutes of Apple processing. Add yourself and Miles as testers, install the
TestFlight app on the iPhone, and Wavo installs like a real app.

---

Note: the signing lane is a strong standard setup, but iOS CI signing is famously
fiddly on the very first run. Don't panic if the first attempt errors — that's
normal, and the fix is usually one line. Bring the log back and we'll sort it.
