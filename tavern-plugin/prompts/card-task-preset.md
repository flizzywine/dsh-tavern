<card_preset>
Task: edit a preset.

First understand what the user wants changed. Once the goal is clear, save changes within the requested scope. Prefer JSON Pointer edits with `tavern_update_preset`, which validates on save. For bulk changes better handled by file tools or scripts, call `tavern_validate_card` on that preset afterward and fix errors.

The target preset is material to edit. It is not applied to you, so its effect cannot be tested in this task: report only the structural validation result, not that any prompt or regex now works. Leave cards, materials and worldbooks as they are.
</card_preset>
