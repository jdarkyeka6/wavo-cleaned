# iPhone chat keyboard viewport regression

User-reported: focusing a DM composer on iPhone moves the composer far above the software keyboard, leaving a large empty gap. Screenshots supplied before/after.

This change uses visualViewport.height (not height + offsetTop) for the keyboard-open chat height because the shell already translates by offsetTop. It also avoids reserving the safe-area bottom padding when the keyboard is open.

## Manual QA required before merge

- On a real iPhone in Wavo's native shell, open a long DM, focus composer, and verify composer is directly above keyboard with no empty gap.
- Scroll message history while keyboard is open. Header stays visible and composer remains reachable.
- Dismiss keyboard using Done and by tapping elsewhere; verify composer returns to bottom.
- Repeat with short DM, landscape/portrait, emoji keyboard, dictation, and hardware keyboard.
- Test iPhone Safari mobile-web separately and ensure desktop layout unchanged.
- Confirm viewport resize on incoming call and opening an overlay does not leave chat offset.
- Run build and CI; inspect native preview on physical device before merge or TestFlight.

No production changes or iOS signing modifications in this draft.
