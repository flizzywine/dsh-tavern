# dsh-asset-library

AGPL-3.0-only asset-pack owner for DSH Tavern. The package root now
mounts **only API v2**: one `assetLibrary` service, native `assetPackSettings`, and
authenticated Connection transport. Host/client cutover and deployment remain
parent integration gates; package activation alone is not a deploy approval.

## Package Boundary

- `dsh-asset-library`: Cordis `name` / `apply`, plus `createAssetPackService` and v2 types.
- `dsh-asset-library/pack-service`: trusted in-process pack CRUD, import/export,
  complete references, media leases, and Card Preparation bundle transactions.
- `dsh-asset-library/pack-settings`: native `asset-library-packs` settings.
- `dsh-asset-library/asset-packs`: portable manifest/figure/sprite contracts.

There is no `./client` export or package-owned editor. Tavern owns the v2 browser
UI. V1 routes/RPCs, card sources/plans/overrides, borrowed-asset storage, card and
library ZIP readers, model-library v1, and per-card media writers are removed.
Old formats are rejected, not migrated or wrapped.

## Roots And Transport

The installer supplies `assetRoot = dshHomePath('profile-data', 'tavern',
'asset-packs')`, separate from Tavern's card data. There are no packaged pack
sources, default packs, automatic imports or special pack identities. All packs
use explicit `inspectImport` / `applyImport`, and are editable and removable.
Offline authoring sources live outside the plugin.

Connection owns browser authentication. `/api/dsh-asset-library/v2/control` uses a
fixed allowlist and bounded JSON. Binary uploads and exports use upload/download
tickets, not JSON byte arrays. Exact media/model GET/HEAD routes are lazy,
buffered, same-origin checked and revoked on changes/detach. Optional Tavern card
transactions resolve the current `tavernAssetCards` owner, including recovery.
Missing Connection/settings/Tavern do not select any legacy fallback.

## Structural Media Validation

The installed plugin supplies the historical `decodeMedia` port with bounded
**structural header validation, not full decoding**. No heavy dependency, native
executable, network operation or codec service is introduced.

PNG/WebP/JPEG validate signatures, dimensions and structural lengths; existing
noninterlaced PNG CRC/inflate/scanline validation is retained. Interlaced PNG uses
CRC/chunk/header validation. Static WebP rejects animation; JPEG requires frame,
scan and end markers. Images are limited to 6 MiB, 8192 per dimension (the retained
WebP guard uses 4096) and 32 Mi pixels; background/avatar limits remain 4/3 MiB.

Audio is limited to 60 MiB. WAV keeps PCM/float chunk/alignment checks; MP3 walks
MPEG Layer III frame headers (optional ID3); Ogg checks a single Opus/Vorbis stream's
pages/header/granules; FLAC checks STREAMINFO/metadata and an initial frame sync;
M4A checks MP4 box bounds, media data and duration headers. Durations come from
headers/sample counts, not decoded samples. Unsupported encodings fail rather
than being guessed. Live2D JSON and relative bundle closure retain existing
validation; moc3 playability is not certified. Successful import does not prove
codec, Cubism Core, audio or GPU playback.

## Build And Tests

`node build.mjs` copies the maintained modules/declarations and removes stale
generated modules. `node build.mjs --check` detects missing, changed or obsolete
artifacts. No package client is generated. Run `node --test tests/*.test.mjs`
with shell-expanded paths and the repository's read-only Windows dependency
fallback when needed. Tests use disposable profiles, real Cordis settings and
Connection authentication, ZIP security fixtures and source-stripped artifacts.
See `PACK-SERVICE.md` for v2 service and transport details.
