import { coreA1 } from "./core-a1";
import { coreA2 } from "./core-a2";
import { coreB1 } from "./core-b1";
import { coreB2 } from "./core-b2";
import type { VocabularyBank } from "./types";

export const core: VocabularyBank = {
  id: "core",
  title_he: "שיחה יומיומית אוניברסלית",
  title_en: "Universal everyday conversation",
  kind: "core",
  audience: "all",
  description_he: "ליבה מצטברת לשיחה יומיומית, מביטויי הישרדות ועד דיון טבעי ומעמיק.",
  levels: [coreA1, coreA2, coreB1, coreB2],
};
