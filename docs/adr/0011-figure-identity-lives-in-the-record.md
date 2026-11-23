# 0011: A figure's name, trigger words and outfit names live only in its image-library record

Status: accepted. It replaces the "pack or registry" storage switch the host used to have.

## Problem

The host could keep a figure's identity (name, trigger words, outfit names) in two ways: `pack` (in the asset pack, with a follower copying it into the image record's `match`) or `registry` (only in the linked image-library record). Keeping both left the same fact written in several places:

1. Saving a linked record in the image plugin wrote added or removed words back to the asset-library figure, while writing the figure wrote the record again. Two paths synchronised each other and needed a receipt and a recovery journal not to lose anything.
2. The same list had three names on screen: 「触发词」 on the figure page, 「别名」 in the figure page's image-library block, and 「触发别名」 in the image plugin. Users could not tell whether they were one list.
3. A trigger word that contains a comma could not be stored in the record (a comma-separated field), so such a figure was kept whole in the pack: one figure, two ways of storing it.

## Decision

- **One home: the record.** For a figure linked to an image-library record, name, trigger words and outfit names exist only in that record (`match` is the trigger-word field). The pack's figure document keeps no copy. The asset library fills the identity in when it reads a figure and hands it to the record when it writes one. The figure page and the image library edit the same value, and both call it 「触发词」.
- **Removed:** the `pack` mode and its switch (`figure-records.json`, `FIGURE_RECORD_MODES`, `switchFigureRecords`, the `figureRecordsMode` RPC), the follower's identity sync (`image-character-follow.js`), `tavern.editLinkedFigure(s)` with the asset library's `editFigureIdentities`, and the image plugin's write-back on save. A read-only RPC `figureDocumentForms` remains for tooling.
- **Saving linked records in the plugin does two things** (`tavern.saveLinkedRecords`): the library reads the changed figures again; when a record is deleted or its link changes, the host first writes the identity the record held into the figure document (`releaseFigureIdentities`, in the same recovery receipt as the record save) and then removes the record, so the figure keeps its name.
- **Trigger words contain no separator.** The record stores them as one field separated by `,`, `，` or a newline, so the asset library splits a list item that contains one into several words at ingress (`normalizeFigureAliases`). Storing a figure whole because of a comma is gone.
- **Image plugin disabled or not installed:** the host reads the plugin's `definitions.json` directly (read-only), so names and trigger words stay readable and figures keep working. A figure whose record cannot be found at all reads as "figure data unavailable"; writing it fails with an error that says what to do (enable the image plugin; if it is enabled and still unreadable, restore the image library from a backup). A figure with no record to hold its identity (no library, or several libraries so none can be chosen) keeps it in the pack as before.

## Consequences

- Figures that were kept in the pack under the old default are read through their record when one is linked; the pack copy is ignored and replaced by the record's on the next write. Figures without a linked record are unchanged.
- The plugin (`dsh-tavern-image-bundled`) needs the host side of this change, so they are proposed together.