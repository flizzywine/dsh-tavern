# Stage UI sound cues - credits and licence

The seven cues ("velvet bells") are original procedural synthesis made for this
project (Node.js + FFmpeg/libopus). They contain no third-party samples.

They are dedicated to the public domain under **Creative Commons Zero (CC0 1.0)** -
https://creativecommons.org/publicdomain/zero/1.0/ - so they can be used, changed and
redistributed for any purpose without attribution.

| Cue | File | Description |
| --- | --- | --- |
| open | open.ogg | rising pair |
| close | close.ogg | falling pair |
| move | move.ogg | short low wooden tone |
| confirm | confirm.ogg | octave response |
| cancel | cancel.ogg | falling response |
| toggle | toggle.ogg | single tone |
| choice | choice.ogg | soft three-note rise |

Format: mono 48 kHz Ogg Opus, 96 kb/s, soft attacks and fading tails. Decoded sample
peaks are normalized to about -6 dBFS through the OpusHead output gain.
