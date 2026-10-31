/**
 * "رحلة دريس" — the campaign. Each chapter has its own board theme and one rule
 * twist; stages are plain data turned into game states by stage-state.js.
 *
 * Stage kinds:
 *  match     — a full game against an AI level;
 *  puzzle    — a solver-generated forced win (fail as soon as the win is lost);
 *  defense   — survive a dangerous drawn position against perfect play;
 *  placement — the opponent placed first: place your pieces well, then survive;
 *  boss      — the chapter's final opponent.
 *
 * Goals: { type: 'win', limit? } (limit = your moves) or { type: 'survive', moves }
 * (total moves to last without losing). Stars: complete · no hint · bonus.
 */
import { CLASSIC, MoveRule } from '../core/rules.js';

export const KIND_NAMES = {
  match: 'مباراة',
  puzzle: 'لغز',
  defense: 'دفاع',
  placement: 'تحدّي الصفّ',
  boss: 'الزعيم',
};

export const CHAPTERS = [
  {
    id: 1,
    title: 'البداية',
    theme: 'marble',
    variant: CLASSIC,
    rule: 'القواعد الكلاسيكية',
    ruleDesc: 'الحركة إلى أي مربع فارغ، والفوز بخط أفقي أو عمودي.',
    stages: [
      {
        id: '1-1', kind: 'match', title: 'أول مباراة',
        desc: 'مباراة كاملة ضد خصم مبتدئ. القرعة تحدد من يبدأ الصفّ.',
        opponent: 'easy', setup: { type: 'toss' }, goal: { type: 'win' }, bonus: { type: 'par', moves: 12 },
      },
      {
        id: '1-2', kind: 'puzzle', title: 'الضربة القاضية',
        desc: 'دورك، وحركة واحدة فقط تكمل خطّك. جدها قبل أن يسبقك الخصم.',
        opponent: 'expert', setup: { type: 'puzzle', plies: 1, pick: 0 }, goal: { type: 'win', limit: 1 }, bonus: { type: 'firstTry' },
      },
      {
        id: '1-3', kind: 'puzzle', title: 'تهديدان معاً',
        desc: 'لا يوجد فوز مباشر، لكن هناك حركة تصنع تهديدين لا يستطيع الخصم صدّهما معاً.',
        opponent: 'expert', setup: { type: 'puzzle', plies: 3, pick: 0 }, goal: { type: 'win', limit: 2 }, bonus: { type: 'firstTry' },
      },
      {
        id: '1-4', kind: 'defense', title: 'صدّ الهجوم',
        desc: 'الخصم على بعد حركة من الفوز. أوقفه، ثم اصمد أمام لعب مثالي.',
        opponent: 'expert', setup: { type: 'defense', pick: 0 }, goal: { type: 'survive', moves: 10 }, bonus: { type: 'firstTry' },
      },
      {
        id: '1-5', kind: 'placement', title: 'الصفّ الذكي',
        desc: 'صفّ الخصم قطعه الثلاث أولاً. معظم المواقع المتبقية تخسر، فاختر مواقع قطعك بعناية ثم اصمد.',
        opponent: 'expert', setup: { type: 'placement', pick: 0 }, goal: { type: 'survive', moves: 10 }, bonus: { type: 'firstTry' },
      },
      {
        id: '1-6', kind: 'boss', title: 'أبو حجر', boss: 'أبو حجر',
        desc: 'زعيم الرخام يعاقب كل خطأ. لا تخسر خلال 20 حركة، وإن هزمته فلك النجمة الثالثة.',
        opponent: 'hard', setup: { type: 'toss' }, goal: { type: 'survive', moves: 20 }, bonus: { type: 'win' },
      },
    ],
  },
  {
    id: 2,
    title: 'خطوة خطوة',
    theme: 'sand',
    variant: { moves: MoveRule.KING },
    rule: 'الحركة خطوة واحدة',
    ruleDesc: 'في التحريك تنتقل القطعة خطوة واحدة إلى مربع ملاصق، حتى قطرياً. ومن لا يجد حركة يخسر.',
    stages: [
      {
        id: '2-1', kind: 'match', title: 'على الرمل',
        desc: 'جرّب القاعدة الجديدة: كل قطعة تتحرك خطوة واحدة فقط. اهزم خصماً متوسطاً.',
        opponent: 'medium', setup: { type: 'toss' }, goal: { type: 'win' }, bonus: { type: 'par', moves: 16 },
      },
      {
        id: '2-2', kind: 'puzzle', title: 'خطوتان للنصر',
        desc: 'افُز خلال حركتين من حركاتك. الخصم يدافع بإتقان.',
        opponent: 'expert', setup: { type: 'puzzle', plies: 3, pick: 0 }, goal: { type: 'win', limit: 2 }, bonus: { type: 'firstTry' },
      },
      {
        id: '2-3', kind: 'puzzle', title: 'ثلاث خطوات',
        desc: 'خطة أطول: افُز خلال ثلاث حركات من حركاتك.',
        opponent: 'expert', setup: { type: 'puzzle', plies: 5, pick: 0 }, goal: { type: 'win', limit: 3 }, bonus: { type: 'firstTry' },
      },
      {
        id: '2-4', kind: 'puzzle', title: 'الطريق الطويل',
        desc: 'أعمق لغز في هذه القاعدة: افُز خلال أربع حركات من حركاتك.',
        opponent: 'expert', setup: { type: 'puzzle', plies: 7, pick: 0 }, goal: { type: 'win', limit: 4 }, bonus: { type: 'firstTry' },
      },
      {
        id: '2-5', kind: 'defense', title: 'العاصفة الرملية',
        desc: 'الخصم يهددك والحركة محدودة. اصمد 12 حركة أمام لعب مثالي.',
        opponent: 'expert', setup: { type: 'defense', pick: 0 }, goal: { type: 'survive', moves: 12 }, bonus: { type: 'firstTry' },
      },
      {
        id: '2-6', kind: 'boss', title: 'شيخ الرمل', boss: 'شيخ الرمل',
        desc: 'شيخ الرمل يعرف كل وضعيات هذه القاعدة. لا تخسر خلال 20 حركة.',
        opponent: 'expert', setup: { type: 'toss' }, goal: { type: 'survive', moves: 20 }, bonus: { type: 'firstTry' },
      },
    ],
  },
  {
    id: 3,
    title: 'القطري يُحتسب',
    theme: 'chalk',
    variant: { diagonals: true },
    rule: 'القطري يُحتسب',
    ruleDesc: 'الخط القطري صار فوزاً أيضاً، فالتهديدات أكثر والخطأ أغلى.',
    stages: [
      {
        id: '3-1', kind: 'match', title: 'خطوط جديدة',
        desc: 'الأقطار صارت تفوز. اهزم خصماً متوسطاً في هذه القاعدة.',
        opponent: 'medium', setup: { type: 'toss' }, goal: { type: 'win' }, bonus: { type: 'par', moves: 12 },
      },
      {
        id: '3-2', kind: 'puzzle', title: 'الضربة المائلة',
        desc: 'الفوز الوحيد هنا بخط قطري. جده بحركة واحدة.',
        opponent: 'expert', setup: { type: 'puzzle', plies: 1, pick: 0, lineType: 'diagonal' }, goal: { type: 'win', limit: 1 }, bonus: { type: 'firstTry' },
      },
      {
        id: '3-3', kind: 'puzzle', title: 'الشبكة',
        desc: 'اصنع تهديدين في وقت واحد وافُز خلال حركتين.',
        opponent: 'expert', setup: { type: 'puzzle', plies: 3, pick: 0 }, goal: { type: 'win', limit: 2 }, bonus: { type: 'firstTry' },
      },
      {
        id: '3-4', kind: 'placement', title: 'صفّ تحت الضغط',
        desc: 'صفّ الخصم أولاً والأقطار تحسب. اختر مواقعك بحيث لا يجد فوزاً، ثم اصمد.',
        opponent: 'expert', setup: { type: 'placement', pick: 0 }, goal: { type: 'survive', moves: 10 }, bonus: { type: 'firstTry' },
      },
      {
        id: '3-5', kind: 'boss', title: 'رسّام الطباشير', boss: 'رسّام الطباشير',
        desc: 'يرسم خطوطه في كل اتجاه. لا تخسر خلال 20 حركة، وإن هزمته فلك النجمة الثالثة.',
        opponent: 'hard', setup: { type: 'toss' }, goal: { type: 'survive', moves: 20 }, bonus: { type: 'win' },
      },
    ],
  },
  {
    id: 4,
    title: 'الحجر في الوسط',
    theme: 'wood',
    variant: { moves: MoveRule.ORTH, blocked: [4] },
    rule: 'الوسط مغلق',
    ruleDesc: 'المربع الأوسط مغلق بحجر، والقطعة تتحرك خطوة واحدة أفقياً أو عمودياً. ومن يُحاصَر يخسر.',
    stages: [
      {
        id: '4-1', kind: 'match', title: 'حول الحجر',
        desc: 'ثمانية مربعات فقط وحركة مستقيمة. اهزم خصماً متوسطاً.',
        opponent: 'medium', setup: { type: 'toss' }, goal: { type: 'win' }, bonus: { type: 'par', moves: 16 },
      },
      {
        id: '4-2', kind: 'puzzle', title: 'الدوران',
        desc: 'افُز خلال حركتين من حركاتك.',
        opponent: 'expert', setup: { type: 'puzzle', plies: 3, pick: 0 }, goal: { type: 'win', limit: 2 }, bonus: { type: 'firstTry' },
      },
      {
        id: '4-3', kind: 'puzzle', title: 'المتاهة',
        desc: 'خطة من ثلاث حركات حول الحجر. الخصم يدافع بإتقان.',
        opponent: 'expert', setup: { type: 'puzzle', plies: 5, pick: 0 }, goal: { type: 'win', limit: 3 }, bonus: { type: 'firstTry' },
      },
      {
        id: '4-4', kind: 'boss', title: 'حارس الأبنوس', boss: 'حارس الأبنوس',
        desc: 'سرّ هذه القاعدة: من يصفّ ثانياً يستطيع الفوز دائماً إن لعب بإتقان. الحارس يبدأ وأنت الثاني، فاهزم الخبير!',
        opponent: 'expert', setup: { type: 'fixed', starter: 1 }, goal: { type: 'win' }, bonus: { type: 'firstTry' },
      },
    ],
  },
];

/** Flat lookup helpers. */
export function findStage(id) {
  for (let ci = 0; ci < CHAPTERS.length; ci++) {
    const si = CHAPTERS[ci].stages.findIndex((s) => s.id === id);
    if (si >= 0) return { chapter: CHAPTERS[ci], stage: CHAPTERS[ci].stages[si], ci, si };
  }
  return null;
}

export function nextStageId(id) {
  const f = findStage(id);
  if (!f) return null;
  const { ci, si } = f;
  if (si + 1 < CHAPTERS[ci].stages.length) return CHAPTERS[ci].stages[si + 1].id;
  if (ci + 1 < CHAPTERS.length) return CHAPTERS[ci + 1].stages[0].id;
  return null;
}

export const ALL_STAGES = CHAPTERS.flatMap((c) => c.stages);
export const MAX_STARS = ALL_STAGES.length * 3;
