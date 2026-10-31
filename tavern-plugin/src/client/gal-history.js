// Optional stage presentation slots in ordinary chat.
function galParagraphCount(text) { return stageViews?.chatEntry.count(text) || 0; }
function StageEnterHere(props) { return stageViews ? React.createElement(stageViews.chatEntry.EnterHere, props) : null; }
function StageParagraph(props) { return stageViews ? React.createElement(stageViews.chatEntry.Paragraph, props) : props.children; }
function StageMarkdown(props) { return React.createElement(stageViews ? stageViews.chatEntry.Markdown : TavernColoredMarkdown, stageViews ? props : props.markdownProps); }
