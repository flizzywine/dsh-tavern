# 0012: A figure's settei lives only in its pack; the image plugin reads it through the record's link

Status: accepted. It narrows "reference relations belong to the record": a figure's settei sheets belong to its pack, and an image-library record keeps only pictures a user uploaded to it.

## Problem

A figure's settei was stored twice: once in the asset pack (`identitySettei.board` for the person, `settei` for each outfit) and once as a copy in the linked image-library record (`referenceImage`, an outfit's `characterOutfitImage`). The copy was kept in step by sync code: every write of the figure re-applied `setteiReferences`, older records were filled by `syncFigureSetteiToImageCharacter`, and an outfit without a settei could get its resting sprite copied in by `copyFigureSpriteToImageCharacter`, a copy that never followed later sprite changes.

Sync leaves gaps. A settei unbound from the pack stayed in the record, so scene pictures kept drawing the retired design; sprite copies went stale; figures added later never got a sprite to borrow. One fact should be stored once and read and written in one place (same principle as ADR 0011).

## Decision

- **The pack is the source.** Settei sheets are installed into packs, decide whether sprites are stale and travel with exported packs. Records no longer hold copies.
- **The image plugin reads by link.** For records linked to an asset-library figure (`figurePackId`, `figureId`), before each picture the plugin calls `tavern.figurePictures({figures})` and overlays the answer for that picture only (`withFigurePictures` in `figure-pictures.js`, never saved). Bytes are fetched once through `tavern.readFigurePicture` into the plugin's local reference store (named by SHA-256, a cache, not a second fact). The host has one rule, `figurePackPictures`: the person's settei is the character picture; an outfit uses its settei, or else borrows its resting sprite (`figureOutfitReference`; silhouette, mask and disabled outfits borrow nothing).
- **Uploaded pictures stay in the record and are told apart.** `referenceImage` / `characterOutfitImage` now hold only pictures a user uploaded in the library. Priority: pack settei > uploaded picture > borrowed sprite. The library page shows the pack picture in its slot: a settei is read-only (changed on the asset-library figure page); a borrowed sprite says an upload replaces it.
- **Plugin off.** Without the plugin there are no scene pictures; settei sheets stay in the pack and keep showing, editing and exporting. On a host without the asset library `figurePictures` is absent and records use their uploads as before.
- **Removed sync:** `setteiReferences`, `syncFigureSetteiToImageCharacter`, `copyFigureSpriteToImageCharacter`, `putPackReference`, and `imagePackCharacters`' `includeReferences` (unlinked pack figures use the same `figurePictures`).
- **The host gate follows.** `beforeImageGenerate` waits for a person's settei when the pack has none and the record has no upload, instead of checking the record for a copy.
- **Export and import.** The exported `dsh.image-character` extension carries only uploaded pictures; on import, pictures named in the old copy format (ending in ` 设定图`, ` 立绘参考`, ` 差分参考`, ` 头像参考`) do not enter the record.

## Migration

Existing installs may hold copies in their records. They are harmless (the pack picture takes precedence in the settei slots), and can be cleared slot by slot: a record picture named in the copy format, or equal to what the pack gives that slot, is removed; uploads stay. Compare, per slot, the picture used before and after.

## Consequences

One extra host call per picture (pack metadata, cached); picture bytes are read only when the local store lacks them.
