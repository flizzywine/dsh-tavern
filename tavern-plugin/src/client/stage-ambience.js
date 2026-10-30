// the page-wide ambience owner (stage-ambience.cjs), shared by stage and chat
// like the BGM player; the session binding selects its session.
// @include stage-ambience.cjs
const ambience = createAmbience({
    player: () => createSoundscapePlayer({Audio, mixer: forkStageAudio}),
    session: id => stageSessions.get(id),
    owner: () => stageSessions.resourceOwner,
    authority: source => stageResourceAuthority(source)
});
window.forkSoundscapeDebug = {snapshot: () => ambience.snapshot()};
