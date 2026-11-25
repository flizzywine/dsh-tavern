// Keep the implementations and saved settings available for re-enabling.
const TAVERN_PLAY_FEATURES = Object.freeze({ postureSummary: false, storyLedger: false });

if (typeof window === 'undefined') module.exports = TAVERN_PLAY_FEATURES;
