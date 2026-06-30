import { describe, expect, it } from "vitest";
import { reciprocalRankFusion, fuseRankedLists, RRF_K } from "../rrf.js";

describe("reciprocalRankFusion", () => {
	it("scores rank 0 of a single list as 1/(k+1)", () => {
		const scores = reciprocalRankFusion([["a", "b"]]);
		expect(scores.get("a")).toBeCloseTo(1 / (RRF_K + 1), 12);
		expect(scores.get("b")).toBeCloseTo(1 / (RRF_K + 2), 12);
	});

	it("sums contributions across lists for an item present in both", () => {
		const scores = reciprocalRankFusion([
			["a", "b"],
			["b", "a"],
		]);
		// 'a': rank0 + rank1; 'b': rank1 + rank0 — symmetric, so equal.
		expect(scores.get("a")).toBeCloseTo(scores.get("b")!, 12);
		expect(scores.get("a")).toBeCloseTo(1 / (RRF_K + 1) + 1 / (RRF_K + 2), 12);
	});

	it("gives no penalty to items absent from a list", () => {
		const scores = reciprocalRankFusion([["a"], ["b"]]);
		expect(scores.get("a")).toBeCloseTo(1 / (RRF_K + 1), 12);
		expect(scores.get("b")).toBeCloseTo(1 / (RRF_K + 1), 12);
	});

	it("respects a custom k (smaller k sharpens top-rank advantage)", () => {
		const sharp = reciprocalRankFusion([["a", "b"]], 1);
		expect(sharp.get("a")! / sharp.get("b")!).toBeGreaterThan(
			reciprocalRankFusion([["a", "b"]], 1000).get("a")! /
				reciprocalRankFusion([["a", "b"]], 1000).get("b")!,
		);
	});
});

describe("fuseRankedLists", () => {
	it("ranks an item that is top of both lists first", () => {
		const order = fuseRankedLists(
			["x", "y", "z"],
			[
				["x", "y", "z"],
				["x", "z", "y"],
			],
		);
		expect(order[0]).toBe("x");
	});

	it("surfaces an item strong in only one list above a both-mediocre item", () => {
		// 'top' is rank0 in list A but absent from B; 'mid' is rank1 in both.
		const order = fuseRankedLists(
			["top", "mid"],
			[
				["top", "mid"],
				["other", "mid"],
			],
		);
		// top: 1/61 ; mid: 1/62 + 1/62. mid wins because it scores in both lists.
		expect(order[0]).toBe("mid");
		expect(order[1]).toBe("top");
	});

	it("uses the tie-break (higher first) when fused scores are equal", () => {
		const order = fuseRankedLists(
			["a", "b"],
			[
				["a", "b"],
				["b", "a"],
			],
			(id) => (id === "b" ? 100 : 1),
		);
		expect(order[0]).toBe("b");
	});

	it("falls back to stable input order when fused scores and tie-breaks match", () => {
		const order = fuseRankedLists(
			["first", "second"],
			[
				["first", "second"],
				["second", "first"],
			],
		);
		expect(order).toEqual(["first", "second"]);
	});

	it("never invents ids outside the candidate set", () => {
		const order = fuseRankedLists(["a", "b"], [["a", "ghost"], ["b"]]);
		expect(order.sort()).toEqual(["a", "b"]);
	});
});
