/**
 * App wiring: screens, settings, sessions (classic games and campaign stages)
 * and the presenter that turns rule-level events into animations, sounds and
 * HUD updates.
 */
import { Phase, ActionType, CLASSIC, createGame, legalPlacements, threats as threatsOf } from './core/rules.js';
import { prepare, bestAction } from './ai/ai.js';
import { reviewGame } from './ai/review.js';
import { Match } from './game/match.js';
import { LocalHumanPlayer, AIPlayer, sleep } from './game/players.js';
import { Renderer } from './render/renderer.js';
import { THEMES } from './render/themes.js';
import { OPPONENT_PIECE, piecePreview } from './render/pieces.js';
import { SoundEngine } from './audio/sound.js';
import { Music } from './audio/music.js';
import { loadData, saveData, totals } from './ui/storage.js';
import { InputController } from './ui/input.js';
import { Hud } from './ui/hud.js';
import { runToss } from './ui/toss.js';
import { describeEnd, showResult } from './ui/result.js';
import { buildMenu, bindSoundControls } from './ui/menu.js';
import { LEVEL_NAMES, CELL_NAMES, movesPhrase } from './ui/text.js';
import { renderCampaign, stageDialog, goalText } from './ui/campaign.js';
import { showAnalysis } from './ui/analysis.js';
import { CHAPTERS, KIND_NAMES, MAX_STARS, findStage, nextStageId } from './campaign/stages.js';
import { buildStageState, needsToss, puzzleAlive, stageSucceeded, starsFor } from './campaign/play.js';
import { recordStars, starsOf, totalStars, stageUnlocked } from './campaign/progress.js';

const $ = (s) => document.querySelector(s);

/** Pieces shown on the board behind the menus. */
const DEMO_BOARD = [0, null, 1, 1, null, 0, null, 0, 1];
const SCREEN_CAMERA = {
  'screen-menu': 'menu', 'screen-campaign': 'menu', 'screen-collection': 'showcase', 'screen-toss': 'toss', 'screen-game': 'game',
};

class App {
  constructor(RendererClass) {
    this.data = loadData();
    const s = this.data.settings;

    this.sound = new SoundEngine({ volume: s.volume, muted: s.muted });
    this.music = new Music(this.sound);
    this.renderer = new RendererClass($('#board-canvas'), {
      onImpact: (p, k) => this.sound.place(p.type, k),
      onLift: () => this.sound.pickup(),
      getInsets: () => {
        const world = $('#world').getBoundingClientRect();
        const top = $('#hud-top').getBoundingClientRect().bottom - world.top;
        const bottom = world.bottom - $('#hint-bar').getBoundingClientRect().top;
        return { top: Math.max(0, top), bottom: Math.max(0, bottom) };
      },
    });
    this.hud = new Hud();
    this.input = new InputController({
      canvas: $('#board-canvas'),
      renderer: this.renderer,
      sound: this.sound,
      onHint: (text, isError) => this.hud.hint(text, isError),
      onCommit: () => this._clearHint(),
    });
    this.match = null;
    this.session = null;
    this.attempts = {};
    this.thinking = false;
    this.threatSig = '';

    document.body.classList.toggle('no-webgl', !this.renderer.is3D);
    this._applyTheme(s.theme);
    this.syncMenuSound = buildMenu({ settings: s, onChange: (k, v) => this.setSetting(k, v), sound: this.sound });
    this.syncGameSound = bindSoundControls({ settings: s, onChange: (k, v) => this.setSetting(k, v), sound: this.sound, prefix: 'game' });
    this._renderMenuStats();
    this._wire();

    this._showDemo();
    if (this.renderer.is3D) {
      this.renderer.start();
      this.renderer.setMode('menu', { snap: true });
    }
    requestAnimationFrame(() => requestAnimationFrame(() => $('#splash').classList.add('done')));

    // Audio can only start after a user gesture.
    const unlock = () => {
      this.sound.unlock();
      if (this.data.settings.music) this.music.start();
    };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });

    // Precompute the perfect-play tables while the player browses the menu.
    setTimeout(() => {
      prepare('expert');
      for (const c of CHAPTERS) prepare('expert', c.variant);
    }, 400);
  }

  // ───────────────────────── settings ─────────────────────────

  setSetting(key, value) {
    const s = this.data.settings;
    s[key] = value;
    saveData(this.data);
    if (key === 'theme') this._applyTheme(value);
    if (key === 'piece') this._showDemo();
    if (key === 'level') this._renderMenuStats();
    if (key === 'volume') this.sound.setVolume(value);
    if (key === 'muted') this.sound.setMuted(value);
    if (key === 'music') {
      if (value) this.music.start();
      else this.music.stop();
    }
    if (key === 'muted' || key === 'volume' || key === 'music') {
      this.syncMenuSound();
      this.syncGameSound();
      this._syncSoundButton();
    }
  }

  /** Applies a board theme (visuals, UI accents, sound surface) without saving it. */
  _applyTheme(id) {
    const theme = THEMES[id] || THEMES.wood;
    document.body.dataset.theme = theme.id;
    const root = document.documentElement.style;
    root.setProperty('--accent', theme.ui.accent);
    root.setProperty('--accent-2', theme.ui.accent2);
    root.setProperty('--glow', theme.ui.glow);
    this.renderer.setTheme(theme.id);
    this.sound.setSurface(theme.surface);
  }

  _renderMenuStats() {
    const { level } = this.data.settings;
    const st = this.data.stats[level];
    const all = totals(this.data.stats);
    $('#menu-stats').innerHTML = `
      <div class="stat"><b>${st.w}</b><span>فوز</span></div>
      <div class="stat"><b>${st.d}</b><span>تعادل</span></div>
      <div class="stat"><b>${st.l}</b><span>خسارة</span></div>`;
    const stars = totalStars(this.data.campaign);
    $('#campaign-progress').textContent = `★ ${stars} من ${MAX_STARS} · ألغاز وتحديات وزعماء`;
    $('#menu-stars').textContent = stars;
    $('#menu-wins').textContent = all.w;
    $('#classic-sub').textContent = `ضد الكمبيوتر · مستوى ${LEVEL_NAMES[level]}`;
  }

  /** The player's pieces resting on the board behind the menus. */
  _showDemo() {
    const r = this.renderer;
    const { piece } = this.data.settings;
    r.setPieceTypes([piece, OPPONENT_PIECE[piece]]);
    r.resetPieces(7);
    r.blockedCells = [];
    if (r.is3D) r.showDemo(DEMO_BOARD);
  }

  _syncSoundButton() {
    $('#btn-sound').classList.toggle('is-muted', this.data.settings.muted);
  }

  // ───────────────────────── screens ─────────────────────────

  _show(id) {
    for (const el of document.querySelectorAll('.screen')) el.classList.toggle('is-active', el.id === id);
    const r = this.renderer;
    if (r.is3D) {
      if (id === 'screen-game') r.resize(); // the HUD height may have changed
      return r.setMode(SCREEN_CAMERA[id]);
    }
    if (id === 'screen-game') r.start();
    else r.stop();
    return Promise.resolve();
  }

  _wire() {
    const click = (sel, fn) => $(sel).addEventListener('click', () => {
      this.sound.unlock();
      this.sound.uiClick();
      fn();
    });
    click('#btn-classic', () => this._openModal('#modal-classic'));
    click('#btn-classic-close', () => this._closeModal('#modal-classic'));
    click('#btn-play', () => {
      this._closeModal('#modal-classic');
      this.startClassic();
    });
    click('#btn-settings', () => this._openModal('#modal-settings'));
    click('#btn-settings-close', () => this._closeModal('#modal-settings'));
    click('#btn-how', () => this._openModal('#modal-how'));
    click('#btn-how-close', () => this._closeModal('#modal-how'));
    click('#btn-collection', () => this._show('screen-collection'));
    click('#btn-collection-back', () => this.showMenu());
    for (const [tab, rail, other, otherRail] of [
      ['#tab-themes', '#theme-picker', '#tab-pieces', '#piece-picker'],
      ['#tab-pieces', '#piece-picker', '#tab-themes', '#theme-picker'],
    ]) {
      click(tab, () => {
        $(tab).setAttribute('aria-selected', 'true');
        $(other).setAttribute('aria-selected', 'false');
        $(rail).hidden = false;
        $(otherRail).hidden = true;
      });
    }
    $('#btn-campaign').addEventListener('click', () => {
      this.sound.unlock();
      this.sound.uiClick();
      this.showCampaign();
    });
    $('#btn-campaign-back').addEventListener('click', () => {
      this.sound.uiClick();
      this.showMenu();
    });
    $('#btn-menu').addEventListener('click', () => {
      this.sound.uiClick();
      if (this.match && this.match.state.phase !== Phase.OVER) this._confirmLeave();
      else this.leaveGame();
    });
    $('#btn-confirm-yes').addEventListener('click', () => {
      this._closeModal('#modal-confirm');
      this.leaveGame();
    });
    $('#btn-confirm-no').addEventListener('click', () => this._closeModal('#modal-confirm'));
    $('#btn-hint').addEventListener('click', () => this.useHint());

    const pop = $('#sound-pop');
    $('#btn-sound').addEventListener('click', (e) => {
      e.stopPropagation();
      this.sound.unlock();
      pop.hidden = !pop.hidden;
    });
    document.addEventListener('pointerdown', (e) => {
      if (!pop.hidden && !pop.contains(e.target) && e.target !== $('#btn-sound')) pop.hidden = true;
    });
    this._syncSoundButton();
  }

  _confirmLeave() {
    this._openModal('#modal-confirm');
  }

  _openModal(sel) {
    const m = $(sel);
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('open'));
  }

  _closeModal(sel) {
    const m = $(sel);
    m.classList.remove('open');
    setTimeout(() => {
      m.hidden = true;
    }, 220);
  }

  _stopMatch() {
    if (this.match) this.match.abort();
    this.match = null;
    this.input.reset();
    $('#sound-pop').hidden = true;
  }

  showMenu() {
    this._stopMatch();
    this.session = null;
    this._applyTheme(this.data.settings.theme);
    this._showDemo();
    this._renderMenuStats();
    this._show('screen-menu');
  }

  showCampaign() {
    this._stopMatch();
    this.session = null;
    this._applyTheme(this.data.settings.theme);
    this._showDemo();
    this._show('screen-campaign');
    renderCampaign(this.data.campaign, (id) => this.openStage(id));
  }

  /** Back from a game: to the map for stages, to the menu for classic. */
  leaveGame() {
    if (this.session && this.session.mode === 'stage') this.showCampaign();
    else this.showMenu();
  }

  // ───────────────────────── sessions ─────────────────────────

  startClassic() {
    const level = this.data.settings.level;
    this.startSession({ mode: 'classic', level, theme: this.data.settings.theme, variant: CLASSIC });
  }

  async openStage(id) {
    const found = findStage(id);
    if (!found || !stageUnlocked(this.data.campaign, found.ci, found.si)) return;
    this.sound.uiClick();
    const go = await stageDialog({ ...found, bestStars: starsOf(this.data.campaign, id) });
    if (go) this.startStage(id);
  }

  startStage(id) {
    const { stage, chapter } = findStage(id);
    this.startSession({
      mode: 'stage', stage, chapter, level: stage.opponent, theme: chapter.theme,
      variant: chapter.variant, attempt: (this.attempts[id] || 0) + 1,
    });
  }

  async startSession(session) {
    this._stopMatch();
    this.session = { ...session, hintsUsed: 0, humanMoves: 0 };
    const { mode, stage } = this.session;
    const s = this.data.settings;
    const types = [s.piece, OPPONENT_PIECE[s.piece]];
    this._applyTheme(session.theme);

    const r = this.renderer;
    r.setPieceTypes(types);
    r.resetPieces();
    r.blockedCells = (session.variant.blocked || []).slice();

    const tossed = mode === 'classic' || needsToss(stage);
    let starter = 0;
    if (tossed) {
      this._show('screen-toss');
      starter = await runToss({
        sound: this.sound,
        pieces: types,
        names: ['أنت', (stage && stage.boss) || 'الكمبيوتر'],
        world: r,
      });
      if (!$('#screen-toss').classList.contains('is-active')) return;
    }
    const state = mode === 'classic' ? createGame({ starter }) : buildStageState(stage, session.chapter, starter);
    this.session.initial = state;

    r.syncToState(state);
    this.hud.setup({
      humanImg: piecePreview(types[0], 0, 72, 31),
      aiImg: piecePreview(types[1], 1, 72, 32),
      levelName: LEVEL_NAMES[session.level],
      aiName: (stage && stage.boss) || 'الكمبيوتر',
      tossed,
    });
    this._updateGoal();
    this.hud.update(state);
    this.hud.hint('');
    const current = this.session;
    const arrived = this._show('screen-game');
    this.threatSig = '';
    this._syncHintButton();
    if (mode === 'stage' && !tossed) this.hud.toast(`${KIND_NAMES[stage.kind]}: ${stage.title}`);
    await arrived; // the first turn starts only once the camera has settled on the board
    if (this.session !== current) return;

    const players = [
      new LocalHumanPlayer(this.input),
      new AIPlayer(session.level, { onThinking: (on, st) => this._setThinking(on, st) }),
    ];
    const match = new Match({ players, state, presenter: this });
    this.match = match;
    try {
      await match.run();
    } catch (err) {
      console.error(err);
    }
  }

  _updateGoal() {
    const ss = this.session;
    if (!ss || ss.mode !== 'stage') {
      this.hud.setGoal('', '');
      return;
    }
    let goal = goalText(ss.stage);
    if (ss.stage.goal.limit) {
      const left = ss.stage.goal.limit - ss.humanMoves;
      goal += ` · بقي ${movesPhrase(left)}`;
    }
    this.hud.setGoal(goal, ss.chapter.variant === CLASSIC ? '' : ss.chapter.rule);
  }

  _setThinking(on, state) {
    if (!this.match || this.match.state !== state) return;
    this.thinking = on;
    this.renderer.thinking = on ? 1 : null;
    this.hud.update(state, { thinking: on, threats: this._threats(state) });
  }

  _threats(state) {
    return threatsOf(state);
  }

  /** Easy and medium classic games show helpers (danger cells, win chances). */
  _assist() {
    const ss = this.session;
    return !!ss && ss.mode === 'classic' && (ss.level === 'easy' || ss.level === 'medium');
  }

  // ───────────────────────── hints ─────────────────────────

  _hintAllowed() {
    const ss = this.session;
    return !!ss && (ss.mode === 'stage' || this._assist());
  }

  _syncHintButton() {
    const btn = $('#btn-hint');
    btn.hidden = !this._hintAllowed();
    btn.classList.toggle('is-on', !!this.renderer.hint);
  }

  useHint() {
    if (!this._hintAllowed() || !this.match || !this.input.active) {
      this.sound.error();
      this.hud.hint('التلميح متاح عندما يكون الدور لك', true);
      return;
    }
    const state = this.match.state;
    const best = bestAction(state);
    if (!best) return;
    const r = this.renderer;
    const piece = best.type === ActionType.PLACE ? r.nextTrayPiece(0) : r.pieceAtCell(best.from);
    r.hint = { pieceId: piece && piece.id, to: best.to };
    this.session.hintsUsed++;
    this.sound.select();
    const where = best.type === ActionType.PLACE
      ? `ضع قطعتك في ${CELL_NAMES[best.to]}`
      : `انقل القطعة المضيئة إلى ${CELL_NAMES[best.to]}`;
    const cost = this.session.mode === 'stage' && this.session.hintsUsed === 1 ? ' (كلّفك نجمة «دون تلميح»)' : '';
    this.hud.hint(`تلميح: ${where}${cost}`);
    this._syncHintButton();
  }

  _clearHint() {
    if (!this.renderer.hint) return;
    this.renderer.hint = null;
    this._syncHintButton();
  }

  // ───────────────────────── presenter (called by Match) ─────────────────────────

  onStart(state) {
    this.hud.update(state);
  }

  onTurn(state) {
    const threats = this._threats(state);
    this.hud.update(state, { thinking: this.thinking, threats });
    const mine = state.turn === 0;
    this.renderer.dangerCells = mine && this._assist() ? threats[1] : [];
    const ss = this.session;
    if (state.phase === Phase.PLACEMENT) {
      const blockedByRule = mine && legalPlacements(state.board, 0, state.rules.variant).length
        < state.board.filter((v) => v === null).length;
      this.hud.hint(!mine
        ? `${ss.stage && ss.stage.boss ? ss.stage.boss : 'الكمبيوتر'} يصفّ قطعه…`
        : blockedByRule
          ? `ضع قطعتك ${state.placed[0] + 1} من 3 — المربع المعلَّم بـ✕ ممنوع لأنه يكمل خطاً`
          : `ضع قطعتك ${state.placed[0] + 1} من 3: انقر مربعاً فارغاً أو اسحب القطعة إليه`);
      return;
    }
    if (!mine) {
      this.hud.hint(`${ss.stage && ss.stage.boss ? ss.stage.boss : 'الكمبيوتر'} يفكّر…`);
      return;
    }
    const v = state.rules.variant;
    const how = v.moves === 'any' ? 'إلى أي مربع فارغ' : v.moves === 'orth' ? 'خطوة أفقية أو عمودية' : 'خطوة إلى مربع ملاصق';
    if (this._assist() && threats[0].length) this.hud.hint('فرصتك! يمكنك إكمال خطّ بهذه الحركة');
    else if (threats[1].length) this.hud.hint('انتبه! الخصم على بعد حركة من الفوز');
    else this.hud.hint(`حرّك قطعة ${how}: اسحبها، أو انقرها ثم انقر المربع`);
  }

  async onAction(prev, action, next, meta) {
    const r = this.renderer;
    const match = this.match;
    r.interactiveCells = [];
    r.interactivePieces = [];
    r.dangerCells = [];
    const fromDrag = meta.via === 'drag';
    if (action.type === ActionType.PLACE) {
      await r.animatePlace(action.player, action.to, { pieceId: meta.pieceId || null, fromDrag });
    } else {
      await r.animateMove(action.from, action.to, { fromDrag });
    }
    if (this.match !== match) return; // the player left during the animation

    const ss = this.session;
    if (ss.mode === 'stage' && action.player === 0 && action.type === ActionType.MOVE) {
      ss.humanMoves++;
      this._updateGoal();
      if (next.phase !== Phase.OVER && !puzzleAlive(ss.stage, next, ss.humanMoves)) {
        match.abort();
        this.input.reset();
        this.hud.update(next);
        this._finishStage(next, 'lost-win');
        return;
      }
    }

    if (prev.phase === Phase.PLACEMENT && next.phase === Phase.MOVEMENT) {
      this.sound.phaseChange();
      this.hud.toast('بدأت مرحلة التحريك');
      await sleep(650);
    }

    const threats = this._threats(next);
    this.hud.update(next, { threats });
    if (next.phase === Phase.MOVEMENT) {
      const sig = JSON.stringify(threats);
      if ((threats[0].length || threats[1].length) && sig !== this.threatSig) {
        this.sound.tension(threats[1].length > 0);
      }
      this.threatSig = sig;
    }
  }

  async onEnd(state) {
    this.hud.update(state);
    this._clearHint();
    if (this.session.mode === 'stage') return this._finishStage(state);
    return this._finishClassic(state);
  }

  onIllegal(state, action, reason) {
    console.warn('illegal action ignored', action, reason);
  }

  _celebrate(state, success, failed = false) {
    const r = this.renderer;
    if (state.winLine) r.setWin(state.winLine, state.winner);
    if (success) {
      this.sound.win();
      r.celebrate();
    } else if (failed || state.winner === 1) this.sound.lose();
    else this.sound.draw();
  }

  _review() {
    return reviewGame(this.session.initial, this.match ? this.match.history : this.session.history || [], 0);
  }

  async _finishClassic(state) {
    const info = describeEnd(state);
    const stats = this.data.stats[this.session.level];
    if (info.outcome === 'win') stats.w++;
    else if (info.outcome === 'lose') stats.l++;
    else stats.d++;
    saveData(this.data);
    this._celebrate(state, info.outcome === 'win');
    this.hud.hint(info.outcome === 'win' ? 'أحسنت! صففت قطعك الثلاث' : info.sub);
    const match = this.match;
    await sleep(state.winLine ? 1900 : 1100);
    if (this.match !== match) return; // player left meanwhile
    const review = this._review();
    for (;;) {
      const choice = await showResult({
        info,
        stats,
        caption: `مستوى ${LEVEL_NAMES[this.session.level]}`,
        buttons: [
          { id: 'again', label: 'مباراة جديدة', primary: true },
          { id: 'analysis', label: 'تحليل المباراة' },
          { id: 'home', label: 'القائمة الرئيسية' },
        ],
      });
      this.sound.uiClick();
      if (choice === 'analysis') {
        await showAnalysis(review);
        continue;
      }
      if (choice === 'again') this.startClassic();
      else this.showMenu();
      return;
    }
  }

  async _finishStage(state, failReason = null) {
    const ss = this.session;
    const { stage } = ss;
    const success = !failReason && stageSucceeded(stage, state);
    const stars = starsFor(stage, { success, hintsUsed: ss.hintsUsed, attempt: ss.attempt, final: state });
    if (success) {
      recordStars(this.data.campaign, stage.id, stars);
      this.attempts[stage.id] = 0;
      saveData(this.data);
    } else {
      this.attempts[stage.id] = (this.attempts[stage.id] || 0) + 1;
    }
    this._celebrate(state, success, !success);
    const match = this.match;
    const history = match ? match.history.slice() : [];
    await sleep(failReason ? 700 : state.winLine ? 1900 : 1100);
    if (this.match !== match || this.session !== ss) return; // player left meanwhile

    const info = this._stageInfo(stage, state, success, failReason);
    const next = nextStageId(stage.id);
    const review = reviewGame(ss.initial, history, 0);
    for (;;) {
      const buttons = success
        ? [
          ...(next ? [{ id: 'next', label: 'المرحلة التالية', primary: true }] : []),
          { id: 'retry', label: 'العب مجدداً', primary: !next },
          { id: 'analysis', label: 'تحليل المباراة' },
          { id: 'map', label: 'خريطة الرحلة' },
        ]
        : [
          { id: 'retry', label: 'حاول مجدداً', primary: true },
          { id: 'analysis', label: 'تحليل المباراة' },
          { id: 'map', label: 'خريطة الرحلة' },
        ];
      const choice = await showResult({
        info,
        stars: success ? stars : 0,
        caption: `${KIND_NAMES[stage.kind]} · ${stage.title}`,
        buttons,
      });
      this.sound.uiClick();
      if (choice === 'analysis') {
        await showAnalysis(review);
        continue;
      }
      if (choice === 'next') this.openStageAfterMap(next);
      else if (choice === 'retry') this.startStage(stage.id);
      else this.showCampaign();
      return;
    }
  }

  /** Shows the map and opens the next stage's dialog on top of it. */
  openStageAfterMap(id) {
    this.showCampaign();
    setTimeout(() => this.openStage(id), 350);
  }

  _stageInfo(stage, state, success, failReason) {
    const name = stage.boss || 'الخصم';
    if (failReason === 'lost-win') {
      return {
        outcome: 'lose',
        title: 'ضاع الفوز',
        sub: 'هذه الحركة أضاعت الفوز في الوقت المحدد، والخصم يدافع بإتقان. ابحث عن الحركة الأدق.',
      };
    }
    if (success) {
      const sub = stage.goal.type === 'survive'
        ? state.winner === 0 ? `صمدت، بل وهزمت ${name}!` : `صمدت ${movesPhrase(state.moveCount)} دون أن تخسر.`
        : describeEnd(state, name).sub;
      return { outcome: 'win', title: 'أحسنت!', sub };
    }
    if (state.winner === 1) return { outcome: 'lose', title: 'لم تنجح هذه المرة', sub: describeEnd(state, name).sub };
    return { outcome: 'draw', title: 'لم تنجح هذه المرة', sub: 'انتهت بالتعادل، والمطلوب هنا الفوز.' };
  }
}

/** Starts the game with the 3D world, or the 2D board where WebGL isn't available. */
async function boot() {
  let RendererClass = Renderer;
  try {
    const force2D = new URLSearchParams(location.search).has('no3d');
    const m = force2D ? null : await import('./render3d/world.js');
    if (m && m.webglAvailable()) RendererClass = m.World3D;
  } catch (err) {
    console.warn('3D world unavailable, using the 2D board', err);
  }
  window.dreesApp = new App(RendererClass);
}

boot();
