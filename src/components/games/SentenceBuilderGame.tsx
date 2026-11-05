import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { CheckCircle, AlertCircle, RotateCcw, Volume2, Sparkles, ArrowRight } from 'lucide-react';

interface SentenceChallenge {
  hebrew: string;
  englishTokens: string[];
  correctEnglish: string;
  explanation: string;
}

export const SentenceBuilderGame: React.FC = () => {
  const { studyMaterials, activeLearnerId, recordGameResult } = useApp();
  const activeMaterial = studyMaterials.find(m => m.customer_id === activeLearnerId && m.is_active_for_phone);

  const defaultChallenges: SentenceChallenge[] = [
    {
      hebrew: 'מהו הרווח התפעולי הנקי לשנה זו?',
      englishTokens: ['What', 'the', 'is', 'net', 'income', 'operating', 'this', 'year?', 'for'],
      correctEnglish: 'What is the net operating income for this year?',
      explanation: 'באנגלית משפט שאלה מתחיל במילת שאלה (What) ולאחריה פועל עזר (is) ונושא המשפט.'
    },
    {
      hebrew: 'אני רוצה להציג את ההצעה העסקית החדשה.',
      englishTokens: ['want', 'I', 'present', 'the', 'to', 'business', 'new', 'proposal.'],
      correctEnglish: 'I want to present the new business proposal.',
      explanation: 'שם תואר (new) מקדים תמיד את שם העצם (proposal), ו-want דורש אחריו to ופועל בצורת מקור.'
    },
    {
      hebrew: 'אנחנו צריכים לתקן את הסעיף לפני החתימה.',
      englishTokens: ['need', 'We', 'clause', 'to', 'the', 'amend', 'signing.', 'before'],
      correctEnglish: 'We need to amend the clause before signing.',
      explanation: 'המילה amend פירושה לתקן מסמך או סעיף. אחרי before מגיע פועל עם ing (before signing).'
    },
    {
      hebrew: 'הספר שלי נמצא בתוך הילקוט הירוק.',
      englishTokens: ['book', 'My', 'is', 'the', 'in', 'green', 'backpack.'],
      correctEnglish: 'My book is in the green backpack.',
      explanation: 'מילת היחס in מציינת פנים, וצבע החפץ (green) מופיע לפני שם העצם (backpack).'
    }
  ];

  // If active material has key phrases, dynamically construct challenges
  const challenges: SentenceChallenge[] = activeMaterial && activeMaterial.key_phrases.length > 0
    ? activeMaterial.key_phrases.map(kp => {
        const words = kp.english.split(' ');
        const scrambled = [...words].sort(() => Math.random() - 0.5);
        return {
          hebrew: kp.hebrew,
          englishTokens: scrambled,
          correctEnglish: kp.english,
          explanation: `תרגול משפט שנלמד מתוך ${activeMaterial.title}`
        };
      })
    : defaultChallenges;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedTokens, setSelectedTokens] = useState<string[]>([]);
  const [availableTokens, setAvailableTokens] = useState<string[]>(() => [...challenges[0].englishTokens]);
  const [feedback, setFeedback] = useState<{ status: 'idle' | 'correct' | 'wrong'; message: string }>({ status: 'idle', message: '' });
  const [totalScore, setTotalScore] = useState(0);

  const currentChallenge = challenges[currentIndex];

  const handlePickWord = (word: string, index: number) => {
    if (feedback.status === 'correct') return;
    setAvailableTokens(prev => prev.filter((_, i) => i !== index));
    setSelectedTokens(prev => [...prev, word]);
    setFeedback({ status: 'idle', message: '' });
  };

  const handleRemoveWord = (word: string, index: number) => {
    if (feedback.status === 'correct') return;
    setSelectedTokens(prev => prev.filter((_, i) => i !== index));
    setAvailableTokens(prev => [...prev, word]);
    setFeedback({ status: 'idle', message: '' });
  };

  const handleCheck = () => {
    const assembled = selectedTokens.join(' ').trim();
    const cleanTarget = currentChallenge.correctEnglish.replace(/[.?!]$/, '').trim();
    const cleanUser = assembled.replace(/[.?!]$/, '').trim();

    if (cleanUser.toLowerCase() === cleanTarget.toLowerCase()) {
      setFeedback({
        status: 'correct',
        message: 'מצוין! סדר המילים מושלם.'
      });
      setTotalScore(prev => prev + 25);

      // Speak sentence
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(currentChallenge.correctEnglish);
        u.lang = 'en-US';
        window.speechSynthesis.speak(u);
      }
    } else {
      setFeedback({
        status: 'wrong',
        message: 'הסדר אינו מדויק עדיין. נסו שוב או שימו לב למבנה הנושא והפועל.'
      });
    }
  };

  const handleNext = () => {
    if (currentIndex < challenges.length - 1) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      setSelectedTokens([]);
      setAvailableTokens([...challenges[nextIndex].englishTokens]);
      setFeedback({ status: 'idle', message: '' });
    } else {
      // Completed game
      recordGameResult({
        game_type: 'sentence_builder',
        game_title: 'בניית משפטים: תחביר ודקדוק',
        score: challenges.length,
        total_questions: challenges.length,
        points_earned: totalScore + 25,
        accuracy_pct: 100
      });
      setFeedback({
        status: 'correct',
        message: 'כל הכבוד! סיימת את כל אתגרי בניית המשפטים!'
      });
    }
  };

  const handleResetCurrent = () => {
    setSelectedTokens([]);
    setAvailableTokens([...currentChallenge.englishTokens]);
    setFeedback({ status: 'idle', message: '' });
  };

  return (
    <div className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e3e8eb] pb-4 mb-6">
        <div>
          <span className="text-xs font-bold tracking-widest text-[#137c69] block mb-1">משחקון 2 · בניית משפטים</span>
          <h2 className="text-xl font-bold text-[#172b35]">Sentence Builder Lab</h2>
          <p className="text-xs text-[#718087] mt-1">
            הרכיבו את המשפט באנגלית בסדר התחבירי הנכון לפי המשמעות בעברית.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#718087]">אתגר {currentIndex + 1} מתוך {challenges.length}</span>
          <button
            onClick={handleResetCurrent}
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition"
            title="איפוס מילים"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Target in Hebrew */}
      <div className="bg-[#f7f5ff] border border-[#e8e7f2] rounded-xl p-4 mb-6">
        <span className="text-xs font-semibold text-[#6d5ce7] block mb-1">תרגמו לאנגלית:</span>
        <h3 className="text-lg font-bold text-[#172033]">{currentChallenge.hebrew}</h3>
      </div>

      {/* Drop Zone / Assembled sentence */}
      <div className="min-h-[72px] bg-[#fafbfc] border-2 border-dashed border-[#dce3e6] rounded-xl p-3 mb-5 flex flex-wrap gap-2 items-center" dir="ltr">
        {selectedTokens.length === 0 ? (
          <span className="text-xs text-[#94a3b8] italic">Click the words below in the correct order to build the sentence...</span>
        ) : (
          selectedTokens.map((token, i) => (
            <button
              key={`${token}_${i}`}
              onClick={() => handleRemoveWord(token, i)}
              className="bg-[#102d32] text-white hover:bg-[#1a454d] px-3 py-1.5 rounded-lg text-sm font-semibold transition flex items-center gap-1.5 shadow-sm"
            >
              <span>{token}</span>
              <span className="text-xs opacity-60">✕</span>
            </button>
          ))
        )}
      </div>

      {/* Available word tiles */}
      <div className="flex flex-wrap gap-2 mb-6" dir="ltr">
        {availableTokens.map((token, i) => (
          <button
            key={`avail_${token}_${i}`}
            onClick={() => handlePickWord(token, i)}
            className="bg-white border border-[#cbd5e1] hover:border-[#137c69] text-[#172b35] hover:bg-[#e9f5f0] px-3 py-1.5 rounded-lg text-sm font-semibold transition shadow-xs"
          >
            {token}
          </button>
        ))}
      </div>

      {/* Feedback banner */}
      {feedback.status !== 'idle' && (
        <div className={`p-4 rounded-xl mb-6 text-sm flex items-start gap-3 ${
          feedback.status === 'correct' ? 'bg-[#e9f5f0] border border-[#b8dfd1] text-[#137c69]' : 'bg-[#fff4df] border border-[#f5dfb8] text-[#93661e]'
        }`}>
          {feedback.status === 'correct' ? <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />}
          <div>
            <p className="font-bold">{feedback.message}</p>
            <p className="text-xs mt-1 text-slate-700">{currentChallenge.explanation}</p>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={handleCheck}
          disabled={selectedTokens.length === 0 || feedback.status === 'correct'}
          className="bg-[#137c69] hover:bg-[#0f6656] disabled:opacity-50 text-white px-6 py-2 rounded-xl text-sm font-bold shadow-sm transition"
        >
          בדיקת תשובה
        </button>

        {feedback.status === 'correct' && (
          <button
            onClick={handleNext}
            className="bg-[#102d32] hover:bg-[#1a454d] text-white px-5 py-2 rounded-xl text-sm font-bold shadow-sm transition flex items-center gap-2"
          >
            <span>{currentIndex < challenges.length - 1 ? 'המשפט הבא' : 'סיום האתגר'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
