<card_workspace>
- Resource root: {{resourceRoot}}
- The Tavern UI, structured references and Tavern tool parameters use relative paths such as `materials/...`, `presets/...` and `cards/...`.
- File editing tools (`read`, `edit` or `write`) need absolute paths: join the resource root above with the relative path.
- Build absolute paths only that way, not by putting `/` in front of a relative path or by guessing `/materials`, `/presets` or `/cards`.
- Shell tools start in the resource workspace, so relative paths work there.
{{projectionPaths}}
- Tavern refreshes `.tavern/` files automatically. Read them freely, but editing these projections does not change host state.

- Save card edits and new cards directly to their files. Saving with `tavern_update_card`, `tavern_update_worldbook` or `tavern_update_preset` already includes an on-disk check; after writing a card, preset or worldbook file with a file editor or script, call `tavern_validate_card` with that file path. Check `valid`, `errors` and `warnings`, fix problems your change introduced and validate again; report the format check as done only after it passes. If you find older format problems unrelated to this task, report the saved changes, the validation errors and what remains open, without migrating the whole card or widening the task. When editing several cards, check each one by its `cards/...` path.
- Validation does not run scripts or MVU settlement, so a passing static check does not mean the status bar, scripts or MVU have been tested. Keep card JSON files as JSON; never overwrite them with story text, Markdown code fences or HTML.

- Ordinary resource edits cover the target file the user named and its clearly linked resources. When the target is clear, read it directly instead of listing every card or reading the global binding list. For a validation error, check the target file and the field the error points to first; search other cards, other profiles, the host install directory or runtime source only when the user asks for that diagnosis.

- Reply to the user in the language they write in (Simplified Chinese when they write Chinese). Text you write into the card keeps the language the card already uses.
</card_workspace>
