import { business } from "./business";
import { core } from "./core";
import { school } from "./school";
import { travel } from "./travel";
import { work } from "./work";
import type { VocabularyBank, VocabularyEntry, VocabularyLevel } from "./types";

export type { VocabularyBank, VocabularyEntry, VocabularyLevel } from "./types";

export const VOCABULARY_BANKS: VocabularyBank[] = [core, travel, work, business, school];

export function getVocabularyBank(id: string): VocabularyBank | undefined {
  return VOCABULARY_BANKS.find((bank) => bank.id === id);
}

export function getLevel(bankId: string, levelId: string): VocabularyLevel | undefined {
  return getVocabularyBank(bankId)?.levels.find((level) => level.id === levelId);
}

export function cumulativeWords(bankId: string, levelId: string): VocabularyEntry[] {
  const bank = getVocabularyBank(bankId);
  const level = getLevel(bankId, levelId);
  if (!bank || !level) return [];
  return bank.levels
    .filter((candidate) => candidate.order <= level.order)
    .sort((a, b) => a.order - b.order)
    .flatMap((candidate) => candidate.words);
}
