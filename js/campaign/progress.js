/** Campaign progress: best stars per stage and what is unlocked. */
import { CHAPTERS, ALL_STAGES } from './stages.js';

export const emptyProgress = () => ({ stars: {} });

export const starsOf = (progress, id) => (progress && progress.stars && progress.stars[id]) || 0;

/** A chapter opens once the previous chapter's final stage (its boss) is completed. */
export function chapterUnlocked(progress, ci) {
  if (ci === 0) return true;
  const prev = CHAPTERS[ci - 1].stages;
  return starsOf(progress, prev[prev.length - 1].id) > 0;
}

export function stageUnlocked(progress, ci, si) {
  if (!chapterUnlocked(progress, ci)) return false;
  return si === 0 || starsOf(progress, CHAPTERS[ci].stages[si - 1].id) > 0;
}

/** Keeps the best result; returns the previous best. */
export function recordStars(progress, id, stars) {
  const prev = starsOf(progress, id);
  if (stars > prev) progress.stars[id] = stars;
  return prev;
}

export const totalStars = (progress) => ALL_STAGES.reduce((acc, s) => acc + starsOf(progress, s.id), 0);

export const chapterStars = (progress, ci) => CHAPTERS[ci].stages.reduce((acc, s) => acc + starsOf(progress, s.id), 0);

/** The first unlocked stage not completed yet (where "continue" should lead). */
export function currentStageId(progress) {
  for (let ci = 0; ci < CHAPTERS.length; ci++) {
    for (let si = 0; si < CHAPTERS[ci].stages.length; si++) {
      if (stageUnlocked(progress, ci, si) && !starsOf(progress, CHAPTERS[ci].stages[si].id)) {
        return CHAPTERS[ci].stages[si].id;
      }
    }
  }
  return null;
}
