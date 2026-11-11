// The dice mod's core client parts (src/client/mod-clients.js): a round's checks lead its chat floor and the stage text
// box's top edge (roll.js), a live roll is thrown over the stage (throw.js), and each round's open checks lead its 履历.
// @include-mod dice/client/roll.js
// @include-mod dice/client/throw.js
tavernModClients.register("dsh.dice", { label: "骰子", floor: DiceRolls, page: DiceRolls, overlay: DiceThrow,
    backlog: { kind: "core.dice.roll", use: useDiceBacklog, entries: diceBacklogEntries, line: diceLine } });
