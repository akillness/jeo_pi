/**
 * Reciprocal Rank Fusion (RRF) — reflected from jeo-code's
 * `reciprocalRankFusion` in `src/agent/memory.ts`.
 *
 * RRF blends several independent ranked lists into one robust ranking without
 * having to normalize their incomparable score scales. Each list contributes
 * `1 / (k + rank)` for an item at 0-based `rank`; the constant `k` damps the
 * influence of top ranks so a single list can't dominate. jeo-pi uses it to
 * fuse the lexical-relevance ranking with the learned recall-value ranking so a
 * memory that is both topically relevant AND historically useful rises, while a
 * memory strong on only one signal still surfaces.
 */

/** jeo-code's default damping constant. */
export const RRF_K = 60;

/**
 * Fuse ranked ID lists into a combined score map. Items absent from a list
 * simply contribute nothing from it (no penalty). Pure and deterministic.
 */
export function reciprocalRankFusion(lists: string[][], k: number = RRF_K): Map<string, number> {
	const scores = new Map<string, number>();
	for (const list of lists) {
		for (let rank = 0; rank < list.length; rank++) {
			const id = list[rank];
			const contribution = 1 / (k + rank + 1);
			scores.set(id, (scores.get(id) ?? 0) + contribution);
		}
	}
	return scores;
}

/**
 * Order a candidate set by fused RRF score (descending). `tieBreak`, when
 * provided, orders items with equal fused score (higher first); otherwise the
 * input order is preserved for ties (stable). Pure.
 */
export function fuseRankedLists(
	candidateIds: string[],
	lists: string[][],
	tieBreak?: (id: string) => number,
	k: number = RRF_K,
): string[] {
	const fused = reciprocalRankFusion(lists, k);
	const indexOf = new Map(candidateIds.map((id, i) => [id, i] as const));
	return [...candidateIds].sort((a, b) => {
		const sa = fused.get(a) ?? 0;
		const sb = fused.get(b) ?? 0;
		if (sb !== sa) return sb - sa;
		if (tieBreak) {
			const ta = tieBreak(a);
			const tb = tieBreak(b);
			if (tb !== ta) return tb - ta;
		}
		return (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0);
	});
}
