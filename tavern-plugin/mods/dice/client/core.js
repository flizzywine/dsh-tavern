// The dice mod's core client parts (src/client/mod-clients.js): a round's checks lead its chat floor and the stage text
// box's top edge (roll.js for tavern_roll, check.js for the card rule checks of tavern_check), a live roll is thrown over
// the stage (throw.js), a check outcome the card's rules stage (outcomes[].show) performs over it (show.js, its picture show-art.js and its sound show-sound.js), and each
// round's open rolls lead its 履历.
// @include-mod dice/client/roll.js
// @include-mod dice/client/throw.js
// @include-mod dice/client/check.js
// @include-mod dice/client/show-sound.js
// @include-mod dice/client/show-art.js
// @include-mod dice/client/show.js
function DiceRound(props) {
    return React.createElement(React.Fragment, null, React.createElement(DiceRolls, props), React.createElement(CheckRecords, props));
}
// One overlay part per mod: the throw and the check performances, each its own layer.
function DiceOverlay(props) {
    return React.createElement(React.Fragment, null, React.createElement(DiceThrow, props), React.createElement(CheckShow, props));
}
tavernModClients.register("dsh.dice", { label: "骰子", floor: DiceRound, page: DiceRound, overlay: DiceOverlay,
    backlog: { kind: "core.dice.roll", use: useDiceBacklog, entries: diceBacklogEntries, line: diceLine } });
