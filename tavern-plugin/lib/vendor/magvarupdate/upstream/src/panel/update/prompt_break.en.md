# Jailbreak strategy

## Use built-in jailbreak

The variable-update AI uses MVU's built-in jailbreak prompt.

Thanks to @离 for providing this prompt. It is designed mainly for Gemini and Claude, but may also
work with other models.

## Use current preset

The variable-update AI receives the prompts from the current preset and relies on that preset's
jailbreak.

Presets often define a writing task, however, so the variable-update AI may continue the story
instead of updating variables directly. It may then analyze variables while advancing the plot,
producing updates that belong to future events rather than the current reply.

## Use another preset

The variable-update AI receives the prompt entries from the saved preset you select, in that
preset's order.

This does not switch SillyTavern's active preset, so it avoids the connection, callback, and
chat-reload overhead caused by switching presets.

Keep in mind:

- MVU reads the saved preset, not unsaved `in_use` edits currently shown in the panel.
- Regex scripts still come from the current environment, not the target preset.
- When the model source is “Custom,” the API address, model name, temperature, and other custom
  request parameters still come from MVU's extra-model settings.
- Only the preset's prompts are applied. Extra custom scripts and API-related settings from that
  preset do not take effect.
