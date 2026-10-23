# Wavo attachment privacy rollout (10 October 2026)

**Status: NOT ready for production until client compatibility and end-to-end tests pass.**
This draft branch addresses *new Google Drive file attachments* only. It deliberately
does **not** change live Supabase settings, delete existing files, or revoke links
in previously sent messages.

## Confirmed live findings

- `messages` SELECT RLS is restricted to the DM sender, recipient, or an admin.
- `group_messages` SELECT RLS is restricted to members or admins.
- The `chat-files` Supabase Storage bucket is **public**, even though regular
  message rows have RLS. Images and voice notes use this bucket.
- The Google Drive upload finish endpoint currently adds `anyone / reader`
  permissions to files, so anyone possessing a previously issued file URL may
  be able to retrieve its contents.
- Files already sent through either system retain their old public URLs unless
  an explicit migration revokes access and updates client rendering.

## What this draft changes

1. Newly finished Drive files no longer receive a public link. If the uploaded
   file unexpectedly has an `anyone` permission, finishing revokes that permission.
2. New file messages store `/api/private-drive-file?id=<ID>` instead of a Google
   Drive URL.
3. The new GET endpoint requires a valid Wavo access token. It looks up the file
   in `drive_files` and grants access only to its uploader or to a user with a
   non-deleted DM/group message **sent by that uploader**, plus relevant chat
   membership. That sender binding prevents forged messages from granting
   access to another user's file merely by guessing its ID.
4. New chat clients explicitly send the access token while downloading files.
5. File uploads no longer silently fall back to Wavo's public `chat-files`
   bucket if Drive is unavailable.

## Before merging

- [ ] Confirm the deployed website and iOS App Store build use these modified
      endpoints and message renderer. Older clients will not know how to open
      the new authenticated URL. Coordinate a client release before enabling
      private Drive links for everyone.
- [ ] Test a file upload/download between two test accounts in a DM.
- [ ] Test member, former member, non-member and unrelated account downloads
      from a group. Non-members and unrelated accounts must receive 404.
- [ ] Test spoofed file ID embedded in a self-sent message; the other file must
      remain inaccessible. Test deleted-message access is revoked for recipients.
- [ ] Test a 1 MB document, 20 MB document, and a 500 MB document from web and
      iOS. Verify streaming/range support and Vercel limits. A 500 MB browser
      Blob download may consume significant device memory and needs follow-up
      optimisation before release.
- [ ] Test expired JWTs, logged-out downloads, banned accounts, and the app's
      file-size limits and deletion path.
- [ ] Ensure Google Drive parent folder has no inherited public permissions.
- [ ] Verify existing Drive files, folders and comments are not accidentally
      made public by inherited or external sharing.

## Remaining priority work

1. **Supabase `chat-files` public bucket**: design a new private bucket and
   authenticated/signed access with RLS using actual conversation memberships.
   Move image/audio uploads and rendering as one coordinated release. Do not
   flip the current bucket to private before compatible clients are deployed.
2. **Existing public attachments**: inventory and migrate message references,
   revoke existing Google Drive `anyone` permissions, and copy or migrate old
   Supabase objects into private storage; retain recoverability for old chats.
3. **Security advisors**: review the 36 anonymous-executable SECURITY DEFINER
   routines. Some routines are intended to run from authenticated clients;
   do not indiscriminately revoke function access without usage tests.
   Supabase security advisor also warns about leaked-password protection and
   mutable search_path on `sync_plan_location`.
4. **Secrets**: older `wavo-clean` commits contain publishable Supabase config
   and a GIPHY key. Check usage/limits and rotate the GIPHY key if abuse is found.
5. **Legacy server**: determine whether Render `wavo-messenger` still operates
   before making password-hashing changes or closing it.

This document is a rollout checklist, not evidence that the live application
has been fixed.
