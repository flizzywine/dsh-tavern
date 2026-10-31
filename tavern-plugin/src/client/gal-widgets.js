// Transitional consumers of the optional stage widget views.
function GalWidgets(props) { return stageViews ? React.createElement(stageViews.widgets.Widgets, props) : null; }
function WidgetCard(props) { return stageViews ? React.createElement(stageViews.widgets.Card, props) : null; }
function getWidgetBoundary() { return stageViews ? stageViews.widgets.boundary() : React.Fragment; }
function stageWidgetCount(name) { stageViews?.widgets.count(name); }
