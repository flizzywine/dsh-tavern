		// The stage (Wiki「设计：cast-presentation」): another view of the same story.
		//the right-panel stage and its full-screen reader are removed; the gal stage
		// (gal-stage.js) is the only stage. What stays is the plugins' public stage data,
		// and the turn's spoken lines (bubbleCastLines) a plugin's turn view gets.
		// @include-domain cast-annotation.js

		function tavernStagePublicData(data) {
			return { enabled: data.enabled !== false, player: data.player, card: data.card, background: data.background || "", characters: data.cast || [], turns: data.turns || [] };
		}
