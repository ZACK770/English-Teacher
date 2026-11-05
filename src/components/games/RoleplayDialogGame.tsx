import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { MessageSquare, Volume2, CheckCircle2, RotateCcw, Award } from 'lucide-react';

interface DialogStep {
  botPrompt: string;
  botPromptHe: string;
  learnerChoices: Array<{
    text: string;
    translationHe: string;
    isOptimal: boolean;
    feedback: string;
  }>;
}

interface Scenario {
  id: string;
  title: string;
  description: string;
  steps: DialogStep[];
}

export const RoleplayDialogGame: React.FC = () => {
  const { recordGameResult } = useApp();

  const scenarios: Scenario[] = [
    {
      id: 'scen_restaurant',
      title: 'הזמנה במסעדה (Dining Out)',
      description: 'תרגול הזמנת מנה, בקשת המלצה וקבלת החשבון באנגלית טבעית.',
      steps: [
        {
          botPrompt: 'Good evening! Welcome to The Olive Tree. Table for one, or are you expecting company?',
          botPromptHe: 'ערב טוב! ברוכים הבאים למסעדת עץ הזית. שולחן לאחד, או שאתם מצפים לעוד אנשים?',
          learnerChoices: [
            {
              text: 'Just for me, thank you. Could I have a table by the window?',
              translationHe: 'רק עבורי, תודה. האם אוכל לקבל שולחן ליד החלון?',
              isOptimal: true,
              feedback: 'מענה מנומס וטבעי לחלוטין.'
            },
            {
              text: 'I want table now.',
              translationHe: 'אני רוצה שולחן עכשיו.',
              isOptimal: false,
              feedback: 'ישיר מדי. באנגלית נהוג להשתמש ב-Could I please have...'
            }
          ]
        },
        {
          botPrompt: 'Certainly, right this way. Here is the menu. What can I start you off with to drink?',
          botPromptHe: 'בוודאי, מכאן בבקשה. הנה התפריט. במה אוכל לפתוח עבורכם לשתייה?',
          learnerChoices: [
            {
              text: 'I would like a glass of sparkling water with lemon, please.',
              translationHe: 'אשמח לכוס מים מוגזים עם לימון, בבקשה.',
              isOptimal: true,
              feedback: 'ניסוח מושלם ומנומס.'
            },
            {
              text: 'Give me water.',
              translationHe: 'תן לי מים.',
              isOptimal: false,
              feedback: 'נשמע כמו פקודה. תמיד עדיף "I would like... please".'
            }
          ]
        }
      ]
    },
    {
      id: 'scen_business',
      title: 'משא ומתן ושיחת היכרות (Business Meeting)',
      description: 'פתיחת שיחה מקצועית, הצגת ערך וקביעת פגישת המשך.',
      steps: [
        {
          botPrompt: 'Hello! Thank you for taking the time to meet today. How has your week been so far?',
          botPromptHe: 'שלום! תודה שהקדשת מזמנך לפגישה היום. איך השבוע שלך מתקדם עד כה?',
          learnerChoices: [
            {
              text: 'It has been quite productive, thank you. I am glad we could connect today.',
              translationHe: 'השבוע היה פורה למדי, תודה. אני שמח שהתחברנו היום.',
              isOptimal: true,
              feedback: 'פתיחת Small-talk עסקית אלגנטית ומקצועית.'
            },
            {
              text: 'All good. Let us talk money.',
              translationHe: 'הכל טוב. בוא נדבר על כסף.',
              isOptimal: false,
              feedback: 'חד מדי; בעסקים בינלאומיים מתחילים עם ברכה קצרה.'
            }
          ]
        },
        {
          botPrompt: 'Wonderful. Let us dive into the proposal. Could you highlight the main competitive advantage of your service?',
          botPromptHe: 'נפלא. בוא נצלול להצעה. האם תוכל להדגיש את היתרון התחרותי המרכזי של השירות שלך?',
          learnerChoices: [
            {
              text: 'Our primary advantage is 24/7 automated availability and personalized learning journeys.',
              translationHe: 'היתרון המרכזי שלנו הוא זמינות אוטומטית 24/7 ומסלולי למידה מותאמים אישית.',
              isOptimal: true,
              feedback: 'תשובה עסקית מדויקת המציגה ערך ברור.'
            },
            {
              text: 'We are very good and cheap.',
              translationHe: 'אנחנו מאוד טובים וזולים.',
              isOptimal: false,
              feedback: 'ניסוח פשטני. השתמש במילים כמו Cost-effective, High quality, Advantage.'
            }
          ]
        }
      ]
    }
  ];

  const [activeScenarioIdx, setActiveScenarioIdx] = useState(0);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [selectedChoiceIdx, setSelectedChoiceIdx] = useState<number | null>(null);
  const [isDone, setIsDone] = useState(false);
  const [score, setScore] = useState(0);

  const scenario = scenarios[activeScenarioIdx];
  const step = scenario.steps[currentStepIdx];

  const playAudio = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    }
  };

  const handleSelectChoice = (idx: number) => {
    if (selectedChoiceIdx !== null) return;
    setSelectedChoiceIdx(idx);
    const choice = step.learnerChoices[idx];
    if (choice.isOptimal) {
      setScore(prev => prev + 1);
    }
    playAudio(choice.text);
  };

  const handleNextStep = () => {
    if (currentStepIdx < scenario.steps.length - 1) {
      setCurrentStepIdx(prev => prev + 1);
      setSelectedChoiceIdx(null);
    } else {
      setIsDone(true);
      recordGameResult({
        game_type: 'roleplay_dialog',
        game_title: `סימולציית תרחיש: ${scenario.title}`,
        score: score + (selectedChoiceIdx !== null && step.learnerChoices[selectedChoiceIdx].isOptimal ? 1 : 0),
        total_questions: scenario.steps.length,
        points_earned: 30,
        accuracy_pct: 100
      });
    }
  };

  const handleReset = () => {
    setCurrentStepIdx(0);
    setSelectedChoiceIdx(null);
    setIsDone(false);
    setScore(0);
  };

  return (
    <div className="bg-white border border-[#e3e8eb] rounded-2xl p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e3e8eb] pb-4 mb-6">
        <div>
          <span className="text-xs font-bold tracking-widest text-[#137c69] block mb-1">משחקון 4 · סימולציית שיחה</span>
          <h2 className="text-xl font-bold text-[#172b35]">Scenario Roleplay Studio</h2>
          <p className="text-xs text-[#718087] mt-1">
            התנסו בשיחות אמת מול הבוט. בחרו את התשובה הטבעית והמקצועית ביותר בכל שלב.
          </p>
        </div>

        {/* Scenario Picker */}
        <div className="flex items-center gap-2">
          {scenarios.map((s, idx) => (
            <button
              key={s.id}
              onClick={() => {
                setActiveScenarioIdx(idx);
                setCurrentStepIdx(0);
                setSelectedChoiceIdx(null);
                setIsDone(false);
                setScore(0);
              }}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                activeScenarioIdx === idx
                  ? 'bg-[#102d32] text-white'
                  : 'bg-[#f5f6f8] text-[#718087] hover:bg-[#e9f5f0] hover:text-[#137c69]'
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>
      </div>

      {isDone ? (
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-[#e9f5f0] text-[#137c69] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Award className="w-8 h-8" />
          </div>
          <h3 className="text-2xl font-extrabold text-[#172b35] mb-2">סימולציית השיחה הושלמה בהצלחה!</h3>
          <p className="text-sm text-[#718087] mb-6">
            צברת 30 נקודות לחשבונך. שליטה בתרחישים מעניקה ביטחון עצום בשיחות טלפון אמיתיות.
          </p>
          <button
            onClick={handleReset}
            className="bg-[#137c69] text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-[#0f6656] transition shadow-sm inline-flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            תרגול נוסף
          </button>
        </div>
      ) : (
        <div>
          {/* Bot Speech Bubble */}
          <div className="bg-[#f2f5f7] rounded-2xl p-5 mb-6 relative border border-[#e3e8eb]">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#137c69] text-white flex items-center justify-center font-bold text-xs">
                  AI
                </div>
                <div>
                  <span className="text-xs font-bold text-[#172b35] block">המורה (הדמיית שיחה)</span>
                  <span className="text-[11px] text-[#718087]">שלב {currentStepIdx + 1} מתוך {scenario.steps.length}</span>
                </div>
              </div>
              <button
                onClick={() => playAudio(step.botPrompt)}
                className="text-[#137c69] hover:text-[#0f6656] p-1.5 rounded-lg hover:bg-white/60 transition"
                title="השמעה קולית"
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </div>
            <p className="text-base font-semibold text-[#172b35] mb-1.5" dir="ltr">{step.botPrompt}</p>
            <p className="text-xs text-[#718087]">{step.botPromptHe}</p>
          </div>

          {/* User Choices */}
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#718087] mb-3">
            איך תבחר/י להגיב?
          </h4>
          <div className="space-y-3 mb-6">
            {step.learnerChoices.map((choice, idx) => {
              const isSelected = selectedChoiceIdx === idx;
              return (
                <button
                  key={idx}
                  disabled={selectedChoiceIdx !== null}
                  onClick={() => handleSelectChoice(idx)}
                  className={`w-full text-right p-4 rounded-xl border text-sm transition text-slate-800 ${
                    isSelected
                      ? choice.isOptimal
                        ? 'bg-[#e9f5f0] border-[#b8dfd1] text-[#137c69]'
                        : 'bg-[#fff0ee] border-[#efc8c3] text-[#b83b49]'
                      : 'bg-white border-[#e3e8eb] hover:border-[#137c69] hover:bg-[#fafbfc]'
                  }`}
                >
                  <p className="font-bold mb-1" dir="ltr">{choice.text}</p>
                  <p className="text-xs text-[#718087]">{choice.translationHe}</p>
                  {selectedChoiceIdx !== null && isSelected && (
                    <div className="mt-2.5 pt-2 border-t border-current/10 text-xs flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{choice.feedback}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {selectedChoiceIdx !== null && (
            <div className="flex justify-end">
              <button
                onClick={handleNextStep}
                className="bg-[#102d32] hover:bg-[#1a454d] text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-sm transition"
              >
                {currentStepIdx < scenario.steps.length - 1 ? 'לשלב הבא בדיאלוג ←' : 'סיום הסימולציה'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
