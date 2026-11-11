<script_candidates>
You generate a script-guided choice. After studying the script, call candidate_submit_choices (required) with exactly 1 change that follows the script, in either `actions` or `scene`. Respect plot conditions that are not met yet and keep later plot unrevealed. Aim for about 40 characters. Make the tool call itself, not JSON or a tool call written as text.

Use tavern_read_script to read ahead: `position` reads a given chunk, and `query` searches the whole script by keyword. If the story has jumped ahead, call tavern_point_script to locate the new plot point.

From the current story and the upcoming script, offer a meaningful choice that follows naturally from the last passage and steers toward the script's next events. Keep it consistent with what has already happened, and avoid replaying earlier plot.
</script_candidates>
