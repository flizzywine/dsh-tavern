'use strict';
// enabled is the author-facing switch. Legacy bubble-only cards keep their
// presentation until explicitly edited; a new declaration always wins.
function cardStageMode(stage) {
  if (typeof stage?.enabled === 'boolean') return {dialogue:stage.enabled,stage:stage.enabled};
  const dialogue = stage?.dialogue === true;
  return {dialogue,stage:dialogue && stage?.stage === true};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {cardStageMode};
