import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { Volume2, Play, CheckCircle2, XCircle, RotateCcw, Award } from 'lucide-react';

interface QuizQuestion {
  id: string;
  spokenEnglish: string;
  questionHe: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export const ListeningQuizGame: React.FC = () => {
  const { studyMaterials, activeLearnerId, recordGameResult } = useApp();
  const activeMaterial = studyMaterials.find(m => m.customer_id === activeLearnerId && m.is_active_for_phone);

  const defaultQuestions: QuizQuestion[] = [
    {
      id: 'q1',
      spokenEnglish: 'Could you please send over the finalized agreement before five in the afternoon?',
      questionHe: 'מה נשאל או התבקש במשפט ששמעת?',
      options: [
        'לשלוח את ההסכם הסופי לפני חמש אחר הצהריים',
        'לתאם פגישה מחודשת בחמש בבוקר',
        'לבטל את ההסכם עקב איחור בשעות העבודה',
        'לבדוק את הסעיף החמישי בחוזה'
      ],
      correctIndex: 0,
      explanation: 'המילים "send over the finalized agreement before five" מציינות שליחת הסכם סופי לפני חמש.'
    },
    {
      id: 'q2',
      spokenEnglish: 'The property has an attractive capitalization rate of eight percent.',
      questionHe: 'מה נאמר לגבי הנכס?',
      options: [
        'הנכס דורש שיפוץ של שמונה אחוזים',
        'לנכס יש שיעור תשואה (Cap Rate) אטרקטיבי של 8%',
        'הבעלים דורש תשלום מקדמה של שמונה אחוז',
        'הנכס נמכר לפני שמונה חודשים'
      ],
      correctIndex: 1,
      explanation: 'Capitalization rate (Cap Rate) הוא שיעור התשואה המהוון של הנכס.'
    },
    {
      id: 'q3',
      spokenEnglish: 'Don’t forget to pack your notebook and pencil in your school backpack.',
      questionHe: 'מה התבקשה התלמידה לעשות?',
      options: [
        'לקנות ילקוט חדש לחזרה ללימודים',
        'לבדוק את מערכת השעות לקראת המבחן',
        'לא לשכוח לארוז את המחברת והעיפרון בילקוט',
        'להניח את הספרים על השולחן בכיתה'
      ],
      correctIndex: 2,
      explanation: 'Notebook = מחברת, pencil = עיפרון, backpack = ילקוט.'
    }
  ];

  const questions = defaultQuestions;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [speakingRate, setSpeakingRate] = useState<number>(0.9);

  const currentQ = questions[currentIndex];

  const playAudio = (rate: number = 0.9) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(currentQ.spokenEnglish);
      u.lang = 'en-US';
      u.rate = rate;
      window.speechSynthesis.speak(u);
    }
  };

  const handleSelectOption = (idx: number) => {
    if (showResult) return;
    setSelectedAnswer(idx);
    setShowResult(true);

    if (idx === currentQ.correctIndex) {
      setScore(prev => prev + 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setSelectedAnswer(null);
      setShowResult(false);
    } else {
      setIsFinished(true);
      recordGameResult({
        game_type: 'listening_quiz',
        game_title: 'אתגר שמיעה והבנה קולית',
        score: score + (selectedAnswer === currentQ.correctIndex ? 1 : 0),
        total_questions: questions.length,
        points_earned: (score + (selectedAnswer === currentQ.correctIndex ? 1 : 0)) * 20,
        accuracy_pct: Math.round(((score + (selectedAnswer === currentQ.correctIndex ? 1 : 0)) / questions.length) * 100)
      });
    }
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setShowResult(false);
    setScore(0);
    setIsFinished(false);
  };

  return (
    <div className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e3e8eb] pb-4 mb-6">
        <div>
          <span className="text-xs font-bold tracking-widest text-[#137c69] block mb-1">משחקון 3 · הבנת הנשמע</span>
          <h2 className="text-xl font-bold text-[#172b35]">Audio Listening Master</h2>
          <p className="text-xs text-[#718087] mt-1">
            האזינו לקולו של המורה באנגלית ובחרו את הפירוש המדויק. אפשר להאזין במהירות רגילה או איטית.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#718087]">שאלה {currentIndex + 1} מתוך {questions.length}</span>
          <button
            onClick={handleRestart}
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition"
            title="איפוס מבחן"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isFinished ? (
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-[#e9f5f0] text-[#137c69] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Award className="w-8 h-8" />
          </div>
          <h3 className="text-2xl font-extrabold text-[#172b35] mb-2">כל הכבוד! סיימת את אתגר ההאזנה</h3>
          <p className="text-sm text-[#718087] mb-6">
            ענית נכון על {score} מתוך {questions.length} שאלות ({Math.round((score / questions.length) * 100)}% דיוק).
          </p>
          <button
            onClick={handleRestart}
            className="bg-[#137c69] text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-[#0f6656] transition shadow-sm"
          >
            התחל שוב
          </button>
        </div>
      ) : (
        <div>
          {/* Audio Playback Box */}
          <div className="bg-[#102d32] text-white rounded-xl p-5 mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => playAudio(0.9)}
                className="w-12 h-12 bg-[#dceab7] hover:bg-[#cbe099] text-[#102d32] rounded-xl flex items-center justify-center shadow-sm transition shrink-0"
                title="השמעת המשפט"
              >
                <Play className="w-6 h-6 fill-current mr-0.5" />
              </button>
              <div>
                <span className="text-xs text-[#acc0bf] block">לחצו להשמעה</span>
                <span className="text-sm font-semibold">האזנה למשפט באנגלית</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => playAudio(0.65)}
                className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1.5"
              >
                <Volume2 className="w-3.5 h-3.5" />
                האזנה איטית (Slow)
              </button>
              <button
                onClick={() => playAudio(1.0)}
                className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg font-medium transition"
              >
                מהירות רגילה (1.0x)
              </button>
            </div>
          </div>

          <h3 className="font-bold text-[#172b35] text-base mb-4">{currentQ.questionHe}</h3>

          {/* Options */}
          <div className="space-y-3 mb-6">
            {currentQ.options.map((opt, idx) => {
              const isSelected = selectedAnswer === idx;
              const isCorrect = idx === currentQ.correctIndex;

              let btnStyle = 'bg-white border-[#e3e8eb] text-[#172b35] hover:border-[#137c69]';
              if (showResult) {
                if (isCorrect) {
                  btnStyle = 'bg-[#e9f5f0] border-[#b8dfd1] text-[#137c69] font-bold';
                } else if (isSelected) {
                  btnStyle = 'bg-[#fff0ee] border-[#efc8c3] text-[#b83b49]';
                } else {
                  btnStyle = 'bg-[#fafbfc] border-[#e3e8eb] text-[#94a3b8] opacity-60';
                }
              }

              return (
                <button
                  key={idx}
                  disabled={showResult}
                  onClick={() => handleSelectOption(idx)}
                  className={`w-full text-right p-3.5 rounded-xl border text-sm transition flex items-center justify-between gap-3 ${btnStyle}`}
                >
                  <span>{opt}</span>
                  {showResult && isCorrect && <CheckCircle2 className="w-4 h-4 text-[#137c69] shrink-0" />}
                  {showResult && isSelected && !isCorrect && <XCircle className="w-4 h-4 text-[#b83b49] shrink-0" />}
                </button>
              );
            })}
          </div>

          {/* Explanation if answered */}
          {showResult && (
            <div className="p-4 bg-[#f7f5ff] border border-[#e8e7f2] rounded-xl mb-6 text-xs text-slate-700">
              <span className="font-bold text-[#6d5ce7] block mb-1">הסבר פדגוגי:</span>
              <p>{currentQ.explanation}</p>
              <p className="mt-1 font-mono text-[11px] text-slate-500" dir="ltr">{currentQ.spokenEnglish}</p>
            </div>
          )}

          {/* Next Button */}
          {showResult && (
            <div className="flex justify-end">
              <button
                onClick={handleNext}
                className="bg-[#137c69] hover:bg-[#0f6656] text-white px-6 py-2 rounded-xl text-sm font-bold shadow-sm transition"
              >
                {currentIndex < questions.length - 1 ? 'לשאלה הבאה ←' : 'סיום האתגר'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
