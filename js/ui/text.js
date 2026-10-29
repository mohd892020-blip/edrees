/** Shared Arabic wording helpers. */
import { MoveRule } from '../core/rules.js';

/** Number–noun agreement for "move(s)". */
export function movesPhrase(n) {
  if (n === 1) return 'حركة واحدة';
  if (n === 2) return 'حركتين';
  if (n >= 3 && n <= 10) return `${n} حركات`;
  return `${n} حركة`;
}

export const LEVEL_NAMES = { easy: 'سهل', medium: 'متوسط', hard: 'صعب', expert: 'خبير' };

export const CELL_NAMES = [
  'أعلى اليسار', 'أعلى الوسط', 'أعلى اليمين',
  'وسط اليسار', 'المركز', 'وسط اليمين',
  'أسفل اليسار', 'أسفل الوسط', 'أسفل اليمين',
];

/** Explains why a move was refused, in the player's terms. */
export function refusalText(reason, variant) {
  switch (reason) {
    case 'cell-occupied':
      return 'هذا المربع مشغول — اختر مربعاً فارغاً';
    case 'blocked-cell':
      return 'هذا المربع مغلق بحجر';
    case 'not-adjacent':
      return variant && variant.moves === MoveRule.ORTH
        ? 'هنا تتحرك القطعة خطوة واحدة أفقياً أو عمودياً'
        : 'هنا تتحرك القطعة خطوة واحدة إلى مربع ملاصق';
    case 'not-your-piece':
      return 'لا يمكنك تحريك قطعة الخصم';
    default:
      return null;
  }
}
