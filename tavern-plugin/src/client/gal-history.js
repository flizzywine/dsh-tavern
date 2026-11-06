// Optional stage presentation slots in ordinary chat.
// Paragraph coordinates (bubble voice keys, plugin media anchors) hold with the stage off: counted from the core's own paragraphs.
function galParagraphCount(text) { return galParagraphs([{ segments: parseBubbles(String(text || ''), false) }]).length; }
function StageEnterHere(props) { return stageViews ? React.createElement(stageViews.chatEntry.EnterHere, props) : null; }
function StageParagraph(props) { return stageViews ? React.createElement(stageViews.chatEntry.Paragraph, props) : props.children; }
function StageMarkdown(props) { return React.createElement(stageViews ? stageViews.chatEntry.Markdown : TavernColoredMarkdown, stageViews ? props : props.markdownProps); }
