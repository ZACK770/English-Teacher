export interface VocabularyEntry {
  en: string;
  he: string;
  pos: 'noun' | 'verb' | 'adj' | 'adv' | 'phrase' | 'function';
}

export interface VocabularyLevel {
  id: string;
  order: number;
  cefr: 'A1' | 'A2' | 'B1' | 'B2';
  title_he: string;
  description_he: string;
  target_size: number;
  words: VocabularyEntry[];
}

export interface VocabularyBank {
  id: string;
  title_he: string;
  title_en: string;
  kind: 'core' | 'topic';
  audience: 'all' | 'youth' | 'adult';
  description_he: string;
  levels: VocabularyLevel[];
}
