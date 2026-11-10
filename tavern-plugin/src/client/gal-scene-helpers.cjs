// Node fixture adapter for the stage package's scene calculations.
const {createStageSceneMath} = require('../../packages/dsh-tavern-stage/src/client/scene-math.cjs');
module.exports = createStageSceneMath({
    colorMath: require('../../shared/color-math.cjs'),
    figureScale: require('../../packages/dsh-presentation-protocol/src/figure-scale.cjs')
});
