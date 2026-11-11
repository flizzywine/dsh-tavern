# OpenCC normalization subset

`keyword-catalogue.cjs` embeds a small character-conversion subset of OpenCC 1.1.9 `TSCharacters.txt`.

- Upstream: https://github.com/BYVoid/OpenCC/tree/ver.1.1.9
- Data: https://github.com/BYVoid/OpenCC/blob/ver.1.1.9/data/dictionary/TSCharacters.txt
- Copyright: OpenCC contributors; licensed under Apache License 2.0 (see `OpenCC-LICENSE.txt`).
- Modification: selected 162 traditional-to-simplified pairs for place, action and sound vocabulary, with 15 identity pairs retained in the parallel strings. No complete dictionary or phrase converter is embedded.
- All nonidentity pairs were checked against the tagged upstream file. Ambiguous conversions use the explicitly embedded value, never locale or context inference.
- Version: `opencc-1.1.9-place-sfx-subset-1`. Additional mappings must change the normalization version and receive review.

This is intentionally incomplete: unfamiliar traditional characters may not recall simplified keywords. Original asset names and IDs are never rewritten.
