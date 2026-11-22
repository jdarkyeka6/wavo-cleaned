# Wavo for Windows

This directory packages the existing https://wavo.lol site into an Electron Windows 10/11 installer. The iPhone app and website code are not duplicated.

## Build locally (Windows)

1. From the repository root, run: cd desktop
2. Run: npm install
3. Run: npm run start (preview desktop shell)
4. Run: npm run build:win (build dist/Wavo-Setup.exe)

Wavo remains an online client: existing chats, accounts, media and backend remain on Wavo's servers.

## Web downloads and releases

1. Open the feature pull request. The Windows workflow builds a Wavo-Windows-Setup artifact for testing.
2. After merging and testing, change desktop/package.json's version and create the matching tag wavo-desktop-vX.Y.Z.
3. The tag workflow builds an installer and creates a DRAFT GitHub release. Check the .exe, latest.yml, and hash/blockmap, then publish.
4. The /download/windows page links to the latest official GitHub release. Before the first release, there is no installer to download.

## Microsoft SmartScreen and antivirus

Unsigned Windows apps often show Microsoft Defender SmartScreen's unknown-publisher warning. That is not a malware finding, but it also does not prove the file is safe. Do not ask users to disable Defender. Sign each released installer under a verified publisher; CI supports WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD secrets for an eligible signing certificate. Signing does not guarantee immediate SmartScreen reputation.

## Security and testing

- Remote pages run with Node integration disabled, context isolation and sandbox enabled.
- Navigation stays inside official Wavo domains. External HTTPS links open in the user's browser.
- Only Wavo can request camera, microphone or notification permissions.
- Test sign-in/out, messaging, file attachments, calling, media permissions, installation/uninstallation, and updates on Windows.
- Browser service worker push behavior may differ in Electron: do not promise background notifications until verified.
- Scan actual installer release artifacts before publishing.
