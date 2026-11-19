import { describe, expect, it } from "vitest";
import { VOCABULARY_BANKS, cumulativeWords, getLevel, getVocabularyBank } from "../src/vocabulary";

const normalize = (en: string) => en.trim().toLowerCase();
const levels = VOCABULARY_BANKS.flatMap((bank) => bank.levels);

describe("curated vocabulary banks", () => {
  it("has the five product banks and the intended audiences", () => {
    expect(VOCABULARY_BANKS.map((bank) => bank.id)).toEqual(["core", "travel", "work", "business", "school"]);
    expect(getVocabularyBank("core")).toMatchObject({ kind: "core", audience: "all" });
    expect(getVocabularyBank("school")).toMatchObject({ kind: "topic", audience: "youth" });
  });

  it("uses unique bank ids and globally unique level ids", () => {
    expect(new Set(VOCABULARY_BANKS.map((bank) => bank.id)).size).toBe(VOCABULARY_BANKS.length);
    expect(new Set(levels.map((level) => level.id)).size).toBe(levels.length);
    expect(new Set([...VOCABULARY_BANKS.map((bank) => bank.id), ...levels.map((level) => level.id)]).size)
      .toBe(VOCABULARY_BANKS.length + levels.length);
    expect([...VOCABULARY_BANKS.map((bank) => bank.id), ...levels.map((level) => level.id)]
      .every((id) => id.length > 0 && id === id.trim())).toBe(true);
  });

  it("keeps the planned sizes and CEFR progression", () => {
    expect(getVocabularyBank("core")!.levels.map((level) => [level.cefr, level.target_size]))
      .toEqual([["A1", 500], ["A2", 500], ["B1", 1000], ["B2", 1000]]);
    for (const bank of VOCABULARY_BANKS.filter((bank) => bank.kind === "topic")) {
      expect(bank.levels.map((level) => [level.cefr, level.target_size]))
        .toEqual([["A2", 100], ["B1", 100], ["B2", 100]]);
    }
  });

  for (const bank of VOCABULARY_BANKS) {
    describe(bank.id, () => {
      it("never repeats an English entry across its levels", () => {
        const words = bank.levels.flatMap((level) => level.words.map((word) => normalize(word.en)));
        expect(words.filter((word, index) => words.indexOf(word) !== index)).toEqual([]);
      });

      it("has unique positive sequential level orders", () => {
        expect(bank.levels.map((level) => level.order)).toEqual(bank.levels.map((_, index) => index + 1));
      });

      for (const level of bank.levels) {
        it(`${level.id} has exactly its target size and complete bilingual entries`, () => {
          expect(level.words).toHaveLength(level.target_size);
          for (const word of level.words) {
            expect(word.en.trim(), level.id).not.toBe("");
            expect(word.en).toBe(word.en.trim());
            expect(word.he.trim(), word.en).not.toBe("");
            expect(word.he, word.en).toMatch(/[א-ת]/u);
            expect(["noun", "verb", "adj", "adv", "phrase", "function"]).toContain(word.pos);
            if (/\s/u.test(word.en)) expect(word.pos, word.en).toBe("phrase");
          }
        });
      }
    });
  }
});

describe("vocabulary lookups", () => {
  it("finds banks and scopes level lookups to their own bank", () => {
    expect(getVocabularyBank("travel")).toBe(VOCABULARY_BANKS[1]);
    expect(getLevel("core", "core-2")).toBe(getVocabularyBank("core")!.levels[1]);
    expect(getLevel("travel", "core-2")).toBeUndefined();
  });

  it("includes the selected level and all lower levels, in order", () => {
    const bank = getVocabularyBank("core")!;
    const words = cumulativeWords("core", "core-2");
    expect(words).toHaveLength(1000);
    expect(words).toEqual([...bank.levels[0].words, ...bank.levels[1].words]);
    expect(cumulativeWords("core", "core-1")).toEqual(bank.levels[0].words);
    expect(cumulativeWords("core", "core-4")).toHaveLength(3000);
    expect(cumulativeWords("work", "work-3")).toHaveLength(300);
  });

  it("does not mutate bank order or the selected level's array", () => {
    const bank = getVocabularyBank("core")!;
    const originalLevels = [...bank.levels];
    const words = cumulativeWords("core", "core-1");
    words.pop();
    expect(bank.levels).toEqual(originalLevels);
    expect(bank.levels[0].words).toHaveLength(500);
  });

  it.each(["", "unknown", "CORE"])("handles missing bank %j without throwing", (bankId) => {
    expect(getVocabularyBank(bankId)).toBeUndefined();
    expect(getLevel(bankId, "core-2")).toBeUndefined();
    expect(cumulativeWords(bankId, "core-2")).toEqual([]);
  });

  it.each(["", "unknown", "travel-1"])("handles missing or mismatched level %j", (levelId) => {
    expect(getLevel("core", levelId)).toBeUndefined();
    expect(cumulativeWords("core", levelId)).toEqual([]);
  });
});
