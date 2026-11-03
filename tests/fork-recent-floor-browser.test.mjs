// A send leaves the previous AI floor on screen. Once it stops being the newest floor it must not lose its body to
// content-visibility: on iOS WebKit the skipped body stays an empty band until the next layout (a blank
// area above the previous turn's action row for a few seconds after every send). The newest floor and the few turns
// before it keep their body and paragraphs rendered; floors further back keep the 800 px / 120 px estimates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const css = fs.readFileSync(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8');

test('the floor a send leaves on screen keeps its body and paragraphs rendered at 390 px', { timeout: 30000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
        await page.setContent(`<!doctype html><style>${css}</style><style>
            [data-conversation-scroll]{height:700px;width:390px;overflow:auto}
            ._column{display:flex;flex-direction:column}
            ._column>:not(._flowItem:empty)~:not(._flowItem:empty){margin-top:8px}
            .fork-bubbles p{margin:0;height:50px}
        </style><body class="dsh-tavern-shell-active"><div data-slot="conversation.view"><div data-conversation-scroll>
            <div class="_column" data-chat-flow></div></div></div></body>`);
        const result = await page.evaluate(async () => {
            const flow = document.querySelector('[data-chat-flow]');
            const row = (turn, kind, body) => {
                const node = document.createElement('div');
                node.className = '_flowItem';
                Object.assign(node.dataset, { chatFlowKey: kind + '-' + turn, chatFlowKind: kind, chatTurn: String(turn) });
                if (body) node.innerHTML = `<div class="dsh-tavern-assistant"><div class="fork-bubbles">${'<p>第 ' + turn + ' 轮正文</p>'.repeat(10)}</div></div>`;
                else node.innerHTML = `<div style="height:${kind === 'user' ? 40 : 29}px">${kind} ${turn}</div>`;
                flow.append(node);
            };
            // Rounds 1-40 as the host lays them out, the newest floor marked as assistant-renderer marks it.
            for (let turn = 1; turn <= 40; turn++) { row(turn, 'user'); row(turn, 'context'); row(turn, 'assistant-step', true); row(turn, 'turn-tail'); }
            const floorOf = turn => document.querySelector(`[data-chat-flow-key="assistant-step-${turn}"]`);
            floorOf(40).dataset.forkLatestFloor = '';
            const scroller = document.querySelector('[data-conversation-scroll]');
            const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
            scroller.scrollTop = scroller.scrollHeight;
            for (let i = 0; i < 3; i++) await frame();
            // Simulated send: a user row and a running floor join the chat; the newest floor moves back to recent.
            floorOf(40).removeAttribute('data-fork-latest-floor');
            for (let turn = 37; turn <= 40; turn++) floorOf(turn).dataset.forkRecentFloor = '';
            // The running reply is short at first ("深度求索中…"), so the previous body stays partly in view.
            row(41, 'user'); row(41, 'context'); row(41, 'assistant-step', false);
            floorOf(41).dataset.forkLatestFloor = '';
            scroller.scrollTop = scroller.scrollHeight;
            for (let i = 0; i < 3; i++) await frame();
            const visibility = node => getComputedStyle(node).contentVisibility;
            const boxOf = node => node.getBoundingClientRect();
            const scrollerBox = scroller.getBoundingClientRect();
            const sentFloor = floorOf(40);
            const visibleParagraphs = [...sentFloor.querySelectorAll('.fork-bubbles > *')].filter(p => {
                const box = boxOf(p);
                return box.height > 0 && box.bottom > scrollerBox.top && box.top < scrollerBox.bottom;
            }).length;
            return {
                previous: visibility(sentFloor),
                previousParagraphs: visibility(sentFloor.querySelector('.fork-bubbles > *')),
                previousInView: visibleParagraphs,
                farther: visibility(floorOf(36)),
                farParagraphs: visibility(floorOf(36).querySelector('.fork-bubbles > *')),
                newest: visibility(floorOf(41)),
            };
        });
        assert.equal(result.previous, 'visible', 'the floor a send leaves on screen must not be content-visibility:auto');
        assert.equal(result.previousParagraphs, 'visible', 'its paragraphs must not be skipped either');
        assert.ok(result.previousInView > 0, 'some paragraphs of the previous floor are in the viewport');
        assert.equal(result.farther, 'auto', 'a floor more than 4 turns back keeps the estimate');
        assert.equal(result.farParagraphs, 'auto');
        assert.equal(result.newest, 'visible');
    } finally { await browser.close(); }
});
