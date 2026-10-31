"""Plays complete Drees games through the real UI in headless Chrome.

Every human action goes through real pointer input (mouse or touch), alternating
drag-and-drop and tap-tap, from the toss to the result dialog.

Usage (with the game served on http://localhost:8000):
    python tests/e2e/play.py desktop [levels] [theme] [piece] [base_url]
    python tests/e2e/play.py mobile easy,medium,hard,expert neon pit
    python tests/e2e/play.py campaign [desktop|mobile] [base_url]

Environment: SHOTS=<dir> saves screenshots, VERBOSE=1 prints every move,
HUMAN=<level> sets how the simulated player picks moves in classic games.
"""
import json
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from cdp import Browser  # noqa: E402


HELPERS = r"""
window.__e2e = {
  info() {
    const app = window.dreesApp, m = app.match;
    const open = (s) => { const el = document.querySelector(s); return !el.hidden && el.classList.contains('open'); };
    return {
      screen: [...document.querySelectorAll('.screen.is-active')].map(e => e.id)[0],
      tossBtn: !document.querySelector('#btn-toss-go').hidden,
      result: open('#modal-result'),
      stageDialog: open('#modal-stage'),
      classicDialog: open('#modal-classic'),
      analysis: open('#modal-analysis'),
      resultTitle: document.querySelector('#result-title').textContent,
      resultSub: document.querySelector('#result-sub').textContent,
      resultStars: document.querySelectorAll('#result-stars span.on').length,
      pending: !!app.input.pending,
      hint: app.renderer.hint,
      state: m ? m.state : null,
    };
  },
  xy(x, y, z = 0) {
    const r = window.dreesApp.renderer, rect = r.canvas.getBoundingClientRect();
    const p = r.camera.project(x, y, z);
    return [rect.left + p.x / r.dpr, rect.top + p.y / r.dpr];
  },
  center(sel) {
    const el = document.querySelector(sel);
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  },
  cellXY(cell) { return this.xy((cell % 3) - 1, Math.floor(cell / 3) - 1, 0.07); },
  pieceXY(id) { const p = window.dreesApp.renderer.byId(id); return this.xy(p.x, p.y, p.z + 0.07); },
  pieceAtCell(cell) { return window.dreesApp.renderer.pieceAtCell(cell).id; },
  trayPiece(owner) { return window.dreesApp.renderer.nextTrayPiece(owner).id; },
  async choose(level) {
    const ai = await import('/js/ai/ai.js');
    const st = window.dreesApp.match.state;
    return level === 'best' ? ai.bestAction(st) : ai.chooseAction(st, level);
  },
  /** A move that loses the forced win (or wins too slowly) — to test puzzle failure. */
  async wrongMove() {
    const { getSolver } = await import('/js/ai/solver.js');
    const st = window.dreesApp.match.state;
    const r = getSolver(st.rules.variant).rankMoves(st.board, 0);
    const top = Math.max(...r.map((x) => x.score));
    const w = r.find((x) => x.score < top);
    return { type: 'move', player: 0, from: w.from, to: w.to };
  },
  async stageIds() { return (await import('/js/campaign/stages.js')).ALL_STAGES.map((s) => s.id); },
};
true
"""


def wait(b, pred, timeout=60):
    t0 = time.time()
    info = None
    while time.time() - t0 < timeout:
        info = b.js('__e2e.info()')
        if pred(info):
            return info
        time.sleep(0.1)
    raise TimeoutError('condition not met; last info: ' + json.dumps(info, ensure_ascii=False)[:600])


class Player:
    """Performs actions on the board with real pointer events."""

    def __init__(self, b, touch, rnd):
        self.b = b
        self.press = b.tap if touch else b.click
        self.slide = b.touch_drag if touch else b.drag
        self.rnd = rnd

    def act(self, action):
        b = self.b
        dst = b.js(f"__e2e.cellXY({action['to']})")
        use_drag = self.rnd.random() < 0.5
        if action['type'] == 'place':
            if use_drag:
                self.slide(*b.js("__e2e.pieceXY(__e2e.trayPiece(0))"), *dst)
            else:
                self.press(*dst)
        else:
            src = b.js(f"__e2e.pieceXY(__e2e.pieceAtCell({action['from']}))")
            if use_drag:
                self.slide(*src, *dst)
            else:
                self.press(*src)
                time.sleep(0.25)
                self.press(*dst)
        return 'drag' if use_drag else 'tap'

    def play_turns(self, human_level, shots=None, first_move=None, on_turn=None):
        """Plays the human side until the result dialog opens. Returns (info, actions)."""
        b = self.b
        actions = 0
        taken = set()
        while True:
            info = wait(b, lambda i: i['pending'] or i['result'], 150)
            if info['result']:
                return info, actions
            st = info['state']
            if shots and st['phase'] == 'movement' and 'move' not in taken and st['moveCount'] >= 2:
                b.shot(f'{shots}_movement.png')
                taken.add('move')
            if on_turn:
                on_turn(st, actions)
            if first_move and actions == 0 and st['phase'] == 'movement':
                action = b.js(first_move)
            else:
                action = b.js(f"__e2e.choose('{human_level}')")
            via = self.act(action)
            if os.environ.get('VERBOSE'):
                print(f"    ply {st['ply']:>2} moves {st['moveCount']:>2}: {action} via {via}", flush=True)
            before = st['ply']
            wait(b, lambda i: (i['state'] and i['state']['ply'] > before) or i['result'], 8)
            actions += 1
            if shots and 'place' not in taken and st['phase'] == 'placement':
                time.sleep(0.7)
                b.shot(f'{shots}_placement.png')
                taken.add('place')


def play_classic(b, pl, level, human_level='medium', shots=None):
    pl.press(*b.js("__e2e.center('#btn-classic')"))
    wait(b, lambda i: i['classicDialog'], 5)
    pl.press(*b.js(f"__e2e.center('#level-picker [data-level={level}]')"))
    assert b.js('dreesApp.data.settings.level') == level, 'level not selected'
    pl.press(*b.js("__e2e.center('#btn-play')"))
    wait(b, lambda i: i['screen'] == 'screen-toss', 5)
    wait(b, lambda i: i['tossBtn'], 40)
    toss = b.js("document.querySelector('#toss-result').textContent")
    if shots:
        b.shot(f'{shots}_toss.png')
    pl.press(*b.js("__e2e.center('#btn-toss-go')"))
    info = wait(b, lambda i: i['screen'] == 'screen-game' and i['state'] is not None, 10)
    print(f"  toss: {toss} (starter={info['state']['starter']})", flush=True)
    info, actions = pl.play_turns(human_level, shots)
    time.sleep(0.3)
    if shots:
        b.shot(f'{shots}_result.png')
    st = info['state']
    print(f"  result: {info['resultTitle']} | {info['resultSub']} | moves={st['moveCount']} "
          f"winner={st['winner']} draw={st['drawReason']} human_actions={actions}", flush=True)
    pl.press(*b.js("__e2e.center('#btn-home')"))
    wait(b, lambda i: i['screen'] == 'screen-menu', 5)
    time.sleep(0.5)
    return st


def play_stage(b, pl, sid, attempt, shots=None):
    """Opens a stage from the map and plays it. Returns the result info."""
    wait(b, lambda i: i['screen'] == 'screen-campaign', 10)
    time.sleep(0.4)
    pl.press(*b.js(f"__e2e.center('[data-stage=\"{sid}\"]')"))
    wait(b, lambda i: i['stageDialog'], 5)
    if shots and attempt == 1:
        b.shot(f'{shots}_{sid}_dialog.png')
    pl.press(*b.js("__e2e.center('#btn-stage-start')"))
    info = wait(b, lambda i: i['tossBtn'] or (i['screen'] == 'screen-game' and i['state'] is not None), 40)
    if info['tossBtn']:
        pl.press(*b.js("__e2e.center('#btn-toss-go')"))
        wait(b, lambda i: i['screen'] == 'screen-game' and i['state'] is not None, 10)

    first_move = None
    on_turn = None
    if sid == '1-3' and attempt == 1:
        first_move = '__e2e.wrongMove()'  # must fail fast
    if sid == '1-2' and attempt == 1:
        def on_turn(st, n):  # use the hint button once and check it shows a move
            if n == 0:
                pl.press(*b.js("__e2e.center('#btn-hint')"))
                info = wait(b, lambda i: i['hint'] is not None, 3)
                if shots:
                    time.sleep(0.5)
                    b.shot(f'{shots}_{sid}_hint.png')
                assert info['hint']['to'] is not None
    info, _ = pl.play_turns('best', shots=f'{shots}_{sid}' if shots else None, first_move=first_move, on_turn=on_turn)
    time.sleep(0.6)
    if shots:
        b.shot(f'{shots}_{sid}_result{attempt}.png')
    if sid == '1-3' and attempt == 1:
        pl.press(*b.js("__e2e.center('#btn-analysis')"))
        wait(b, lambda i: i['analysis'], 5)
        time.sleep(0.4)
        if shots:
            b.shot(f'{shots}_{sid}_analysis.png')
        pl.press(*b.js("__e2e.center('#btn-analysis-close')"))
        wait(b, lambda i: i['result'], 5)
    pl.press(*b.js("__e2e.center('#btn-map')"))
    wait(b, lambda i: i['screen'] == 'screen-campaign' and not i['result'], 10)
    return info


def run_campaign(b, pl, shots):
    pl.press(*b.js("__e2e.center('#btn-campaign')"))
    ids = b.js('__e2e.stageIds()')
    for sid in ids:
        for attempt in range(1, 5):
            info = play_stage(b, pl, sid, attempt, shots)
            stars = b.js(f"dreesApp.data.campaign.stars['{sid}'] || 0")
            print(f"  {sid} try {attempt}: {info['resultTitle']} | {info['resultSub']} | stars={stars}", flush=True)
            if sid == '1-3' and attempt == 1:
                assert info['resultTitle'] == 'ضاع الفوز', 'a wrong move must fail the puzzle'
                continue
            if stars:
                break
        assert stars > 0, f'stage {sid} not completed'
    if shots:
        time.sleep(0.6)
        b.shot(f'{shots}_map_done.png')
    print('campaign stars:', b.js('JSON.stringify(dreesApp.data.campaign.stars)'), flush=True)


def open_app(b, base):
    b.goto(base)
    b.js('localStorage.clear(); true')
    query = '?no3d=1' if os.environ.get('NO3D') else '?quality=low'
    b.goto(base + query)
    for _ in range(1800):
        if b.js(f"location.search === '{query}' && !!window.dreesApp && document.querySelectorAll('#theme-picker .card').length === 5"):
            break
        time.sleep(0.1)
    else:
        raise TimeoutError('the app did not boot')
    b.js(HELPERS)


def main():
    args = sys.argv[1:]
    mode = args[0] if args else 'desktop'
    shot_dir = os.environ.get('SHOTS')
    if mode == 'campaign':
        device = args[1] if len(args) > 1 else 'desktop'
        base = args[2] if len(args) > 2 else 'http://localhost:8000/'
    else:
        device = mode
        levels = args[1].split(',') if len(args) > 1 else ['easy', 'medium', 'hard', 'expert']
        theme = args[2] if len(args) > 2 else 'marble'
        piece = args[3] if len(args) > 3 else 'pawn'
        base = args[4] if len(args) > 4 else 'http://localhost:8000/'
    touch = device == 'mobile'
    width, height = map(int, os.environ.get('VIEW', '1280x800').split('x'))  # software rendering cost follows the pixels
    b = Browser(width=390, height=844, scale=2, mobile=True) if touch else Browser(width=width, height=height, scale=1)
    pl = Player(b, touch, random.Random(1))
    failed = False
    try:
        open_app(b, base)
        if mode == 'campaign':
            run_campaign(b, pl, os.path.join(shot_dir, f'camp_{device}') if shot_dir else None)
        else:
            b.js(f"dreesApp.setSetting('theme', '{theme}'); dreesApp.setSetting('piece', '{piece}'); true")
            for lvl in levels:
                print(f'[{device}] level={lvl} theme={theme} piece={piece}', flush=True)
                prefix = os.path.join(shot_dir, f'{device}_{lvl}_{theme}') if shot_dir else None
                play_classic(b, pl, lvl, human_level=os.environ.get('HUMAN', 'medium'), shots=prefix)
            print('stats:', b.js('JSON.stringify(dreesApp.data.stats)'), flush=True)
        errors = [l for l in b.logs if l.startswith(('EXCEPTION', 'error'))]
        print('console errors:', errors or 'none', flush=True)
        failed = bool(errors)
    finally:
        b.close()
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
