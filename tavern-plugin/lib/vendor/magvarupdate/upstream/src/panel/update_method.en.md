# Variable update method

Choose how variables are updated so the story model can focus on writing the story.

## Alongside AI output

World-book entries are sent to the AI through SillyTavern's normal flow. The AI includes
variable-update analysis and commands in its reply, and MVU applies those updates.

## Extra-model parsing

This method splits the request: one AI writes the story, then another AI analyzes that story and
updates the variables.

To separate the two tasks, MVU filters world-book entries before sending them through SillyTavern's
normal flow:

- Entries whose names contain `[mvu_plot]` are sent only to the story AI.
- Entries whose names contain `[mvu_update]` are sent only to the variable-update AI.
- Entries containing neither `[mvu_plot]` nor `[mvu_update]` are sent to both AIs.

An MVU character card therefore needs `[mvu_plot]` or `[mvu_update]` in its world-book entry names
to support extra-model parsing.

Cards made with the latest [MVU tutorial](https://stagedog.github.io/络络/教程/手写mvu变量卡/)
support extra-model parsing directly. You can also use that tutorial to adapt older cards.
