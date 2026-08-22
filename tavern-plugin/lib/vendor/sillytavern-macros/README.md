# SillyTavern Macros 2.0 parser

This directory contains adapted parser and evaluator files from
[SillyTavern](https://github.com/SillyTavern/SillyTavern) commit
`8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`.

Upstream files:

- `public/scripts/macros/engine/MacroLexer.js`
- `public/scripts/macros/engine/MacroParser.js`
- `public/scripts/macros/engine/MacroFlags.js`
- `public/scripts/macros/engine/MacroRegistry.js`
- `public/scripts/macros/engine/MacroCstWalker.js`
- `public/scripts/macros/engine/MacroEngine.js`

dsh-tavern replaces SillyTavern browser globals, diagnostics and variable
storage with local adapters. Upstream is licensed under AGPL-3.0; see
`LICENSE` in this directory.
