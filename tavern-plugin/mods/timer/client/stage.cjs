'use strict';
// The timer's stage feature (src/client/features.cjs): the countdown view, built per view scope; client/stage.css is its CSS.
const {createStageTimer} = require('./timer.cjs');
module.exports = {views:({options, views, own, window, getResourceOwner}) => ({
    timer:own(createStageTimer({React:options.React, window, ...options.timer, getResourceOwner,
        createRects:views.performanceSurface.createRects, createKeyframeLayer:views.performanceSurface.createKeyframeLayer,
        performanceSafety:views.performanceSurface.safety}))
})};
