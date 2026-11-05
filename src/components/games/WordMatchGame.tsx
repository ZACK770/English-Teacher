import React, { useState, useEffect } from 'react';
import { useApp } from '../../store/AppContext';
import { Sparkles, RotateCcw, CheckCircle2, Trophy, Volume2 } from 'lucide-react';

interface CardItem {
  id: string;
  text: string;
  pairId: string;
  lang: 'en' | 'he';
  isMatched: boolean;
  isSelected: boolean;
}

export const WordMatchGame: React.FC = () => {
  const { studyMaterials, activeLearnerId, recordGameResult } = useApp();
  const activeMaterial = studyMaterials.find(m => m.customer_id === activeLearnerId && m.is_active_for_phone);

  const defaultPairs = [
    { en: 'Negotiate', he: 'לנהל משא ומתן' },
    { en: 'Opportunity', he: 'הזדמנות' },
    { en: 'Confidence', he: 'ביטחון עצמי' },
    { en: 'Vocabulary', he: 'אוצר מילים' },
    { en: 'Schedule', he: 'לוח זמנים' },
    { en: 'Practice', he: 'לתרגל' }
  ];

  const sourcePairs = activeMaterial && activeMaterial.vocabulary.length >= 4
    ? activeMaterial.vocabulary.slice(0, 6).map(v => ({ en: v.english, he: v.hebrew }))
    : defaultPairs;

  const [cards, setCards] = useState<CardItem[]>([]);
  const [selectedCards, setSelectedCards] = useState<CardItem[]>([]);
  const [score, setScore] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);

  const initGame = () => {
    const rawCards: CardItem[] = [];
    sourcePairs.forEach((pair, idx) => {
      rawCards.push({
        id: `en_${idx}`,
        text: pair.en,
        pairId: `pair_${idx}`,
        lang: 'en',
        isMatched: false,
        isSelected: false
      });
      rawCards.push({
        id: `he_${idx}`,
        text: pair.he,
        pairId: `pair_${idx}`,
        lang: 'he',
        isMatched: false,
        isSelected: false
      });
    });

    // Shuffle
    const shuffled = [...rawCards].sort(() => Math.random() - 0.5);
    setCards(shuffled);
    setSelectedCards([]);
    setScore(0);
    setAttempts(0);
    setIsGameOver(false);
  };

  useEffect(() => {
    initGame();
  }, [activeMaterial]);

  const handleCardClick = (card: CardItem) => {
    if (card.isMatched || card.isSelected || selectedCards.length === 2) return;

    // Speak English card
    if (card.lang === 'en' && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(card.text);
      u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    }

    const updated = cards.map(c => c.id === card.id ? { ...c, isSelected: true } : c);
    setCards(updated);
    const newSelected = [...selectedCards, card];
    setSelectedCards(newSelected);

    if (newSelected.length === 2) {
      setAttempts(prev => prev + 1);
      const [c1, c2] = newSelected;
      if (c1.pairId === c2.pairId) {
        // Match found!
        setTimeout(() => {
          setCards(prev => prev.map(c => (c.id === c1.id || c.id === c2.id) ? { ...c, isMatched: true, isSelected: false } : c));
          setSelectedCards([]);
          setScore(prev => {
            const nextScore = prev + 1;
            if (nextScore === sourcePairs.length) {
              setIsGameOver(true);
              recordGameResult({
                game_type: 'word_match',
                game_title: activeMaterial ? `התאמת מילים: ${activeMaterial.title}` : 'התאמת מילים: אוצר מילים כללי',
                score: nextScore,
                total_questions: sourcePairs.length,
                points_earned: nextScore * 10,
                accuracy_pct: Math.round((nextScore / (attempts + 1)) * 100)
              });
            }
            return nextScore;
          });
        }, 350);
      } else {
        // Mismatch
        setTimeout(() => {
          setCards(prev => prev.map(c => (c.id === c1.id || c.id === c2.id) ? { ...c, isSelected: false } : c));
          setSelectedCards([]);
        }, 900);
      }
    }
  };

  return (
    <div className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e3e8eb] pb-4 mb-6">
        <div>
          <span className="text-xs font-bold tracking-widest text-[#137c69] block mb-1">משחקון 1 · התאמת מילים</span>
          <h2 className="text-xl font-bold text-[#172b35] flex items-center gap-2">
            <span>Word Match Arena</span>
            {activeMaterial && (
              <span className="text-xs bg-[#e9f5f0] text-[#137c69] px-2.5 py-1 rounded-full font-medium">
                נושא: {activeMaterial.title}
              </span>
            )}
          </h2>
          <p className="text-xs text-[#718087] mt-1">
            חברו בין המילה באנגלית לפירוש שלה בעברית. לחיצה על מילה באנגלית משמיעה את ההגייה.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs bg-[#f5f6f8] px-3 py-1.5 rounded-lg border border-[#e3e8eb]">
            התאמות: <span className="font-bold tabular-nums text-[#137c69]">{score}</span> / {sourcePairs.length}
          </div>
          <button
            onClick={initGame}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#e3e8eb] hover:bg-[#f5f6f8] text-[#172b35] transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            התחל מחדש
          </button>
        </div>
      </div>

      {isGameOver ? (
        <div className="text-center py-10 px-4">
          <div className="w-16 h-16 bg-[#e9f5f0] text-[#137c69] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <Trophy className="w-8 h-8" />
          </div>
          <h3 className="text-2xl font-extrabold text-[#172b35] mb-2">כל הכבוד! סיימת את המשחק</h3>
          <p className="text-sm text-[#718087] max-w-md mx-auto mb-6">
            השלמת את כל {sourcePairs.length} ההתאמות ב-{attempts} ניסיונות. צברת {score * 10} נקודות שנוספו לחשבון שלך!
          </p>
          <button
            onClick={initGame}
            className="bg-[#137c69] hover:bg-[#0f6656] text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-sm transition inline-flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            סיבוב נוסף
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {cards.map(card => {
            const isEnglish = card.lang === 'en';
            return (
              <button
                key={card.id}
                disabled={card.isMatched}
                onClick={() => handleCardClick(card)}
                className={`min-h-[78px] p-3 rounded-xl border text-sm font-semibold transition-all flex flex-col items-center justify-center text-center relative ${
                  card.isMatched
                    ? 'bg-[#e9f5f0] border-[#b8dfd1] text-[#137c69] opacity-60 cursor-default'
                    : card.isSelected
                    ? 'bg-[#102d32] border-[#102d32] text-white scale-[1.02] shadow-md'
                    : 'bg-[#fafbfc] border-[#e3e8eb] text-[#172b35] hover:border-[#137c69] hover:bg-white'
                }`}
                dir={isEnglish ? 'ltr' : 'rtl'}
              >
                {isEnglish && (
                  <span className="absolute top-2 left-2 text-[10px] text-slate-400">
                    <Volume2 className="w-3 h-3" />
                  </span>
                )}
                <span>{card.text}</span>
                {card.isMatched && (
                  <span className="text-[10px] mt-1 text-[#137c69] font-normal flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    הותאם
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
