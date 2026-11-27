# Gal-stage check-show harmonic beds — credits and licence

`check-show-bed.ogg` and `check-show-calm.ogg` are the harmonic climax and
reduced-motion beds mixed with the procedural 16-beat skeleton in
`tavern-plugin/mods/dice/client/show-sound.js` for the `converge` check show.

- **Origin**: AI-generated audio produced on 2026-11-22 with Google Lyria 3.5
  (`lyria-3.5`, retro 1970s corporate brass & organ major triad motif), then
  pitch-aligned (`-2.00` semitones to A440), high-passed, envelope-shaped to
  `SHOW_T` (`T.hit` 2.76 s → `T.accent` 4.26 s → `T.end` 6.16 s), and encoded
  as stereo 48 kHz Ogg Opus (`128 kb/s`) with FFmpeg/libopus.
- **Third-party recordings**: None. No third-party copyrighted recordings or
  samples are included.
- **Fallback**: If either `.ogg` file cannot be fetched or decoded, `show.js`
  and `show-sound.js` automatically fall back to pure procedural synthesis.
