// The dice mod's core client parts (src/client/mod-clients.js): a round's checks lead its chat floor and the stage text
// box's top edge (roll.js for tavern_roll, check.js for the card rule checks of tavern_check), a live roll is thrown over
// the stage in the shared 3D dice (dice3d.js: the d100 of throw.js, a rule check's timeline in check-throw.js with its
// result page and effect points in check-result.js), a check outcome the card's rules stage (outcomes[].show) performs over it (show.js, its picture show-art.js and its sound show-sound.js), and each
// round's open rolls lead its 履历. A record the body model called for partway through its reply shows on the stage where
// the reader comes to that place in the text (place.js).
// @include-mod dice/client/place.js
// @include-mod dice/client/roll.js
// @include-mod dice/client/dice3d.js
// @include-mod dice/client/throw.js
// @include-mod dice/client/check.js
// @include-mod dice/client/check-result.js
// @include-mod dice/client/show-sound.js
// @include-mod dice/client/show-art.js
// @include-mod dice/client/show.js
// @include-mod dice/client/check-throw.js
function DiceRound(props) {
    return React.createElement(React.Fragment, null, React.createElement(DiceRolls, props), React.createElement(CheckRecords, props));
}
// One overlay part per mod: the throws and the check performances, each its own layer.
function DiceOverlay(props) {
    return React.createElement(React.Fragment, null, React.createElement(DiceThrow, props), React.createElement(CheckThrow, props), React.createElement(CheckShow, props));
}
tavernModClients.register("dsh.dice", { label: "骰子", floor: DiceRound, page: DiceRound, overlay: DiceOverlay,
    backlog: { kind: "core.dice.roll", use: useDiceBacklog, entries: diceBacklogEntries, line: diceLine } });
