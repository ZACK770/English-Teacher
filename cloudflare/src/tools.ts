// Generated from app/gemini_live.py tool declarations.
export const OBSERVATION_TOOL = {
  "name": "record_learning_observation",
  "description": "Record one short, privacy-safe learning assessment.",
  "parameters": {
    "type": "object",
    "properties": {
      "skill": {
        "type": "string",
        "enum": [
          "fluency",
          "grammar",
          "vocabulary",
          "pronunciation",
          "comprehension"
        ]
      },
      "result": {
        "type": "string",
        "description": "What the learner did well"
      },
      "correction": {
        "type": "string",
        "description": "A concise correction if needed"
      },
      "score": {
        "type": "integer",
        "minimum": 1,
        "maximum": 5
      }
    },
    "required": [
      "skill",
      "result",
      "correction",
      "score"
    ]
  }
};

export const LESSON_SUMMARY_TOOL = {
  "name": "record_lesson_summary",
  "description": "Save the Hebrew end-of-lesson summary and the points awarded.",
  "parameters": {
    "type": "object",
    "properties": {
      "summary_he": {
        "type": "string",
        "description": "A short Hebrew summary of what was practiced"
      },
      "success_he": {
        "type": "string",
        "description": "A short Hebrew description of what went well"
      },
      "next_step_he": {
        "type": "string",
        "description": "One concrete next step in Hebrew"
      },
      "points": {
        "type": "integer",
        "minimum": 0,
        "maximum": 100,
        "description": "Encouraging lesson points based on observed effort and success"
      }
    },
    "required": [
      "summary_he",
      "success_he",
      "next_step_he",
      "points"
    ]
  }
};

export const INTAKE_TOOL = {
  "name": "save_intake",
  "description": "Save the learner's lesson direction. For first-call intake send goal and level. After intake, send the goal and only the fields the learner asked to change.",
  "parameters": {
    "type": "object",
    "properties": {
      "learner_name": { "type": "string", "description": "The learner's first name as they said it" },
      "goal": { "type": "string", "enum": ["work", "travel", "study", "other"], "description": "Why the learner wants English. travel: trips, vacations, flights abroad. study: school, university, exams. Wanting to learn English is not itself study; use the purpose they named." },
      "level": { "type": "string", "enum": ["beginner", "intermediate", "fluent"], "description": "The learner's stated level: beginner (מתחיל), intermediate (בינוני), or fluent for advanced (מתקדם/שוטף, B2–C2). Do not substitute the old lesson level or a vocabulary access limit." },
      "difficulty": { "type": "string", "enum": ["speaking", "listening", "writing"] },
      "minutes": { "type": "integer", "description": "Lesson length in minutes. Choose 5, 10, or 20." },
      "topic": { "type": "string", "description": "Use recommended when the learner has no specific topic preference", "enum": ["recommended", "everyday", "business", "travel", "flights", "medicine", "academic", "property", "cars", "career", "school"] },
      "personality": { "type": "string", "enum": ["warm", "focused", "playful"] },
      "pace": { "type": "string", "enum": ["slow", "normal", "fast"], "description": "Speaking pace" },
      "conversation_mode": { "type": "string", "enum": ["guided", "conversation", "roleplay"], "description": "guided: learn together with Hebrew help; conversation: learn through conversation; roleplay: just talk" }
    },
    "required": ["goal"]
  }
};

export const END_SESSION_TOOL = {
  "name": "end_session",
  "description": "Finish generating the entire spoken summary and final goodbye BEFORE calling. Then end this AI session when the caller asks to stop or the permitted task is done. The server will play all buffered speech before hanging up or transferring. Do not leave a finished conversation running. The server controls phone disposition.",
  "parameters": {
    "type": "object",
    "properties": {
      "reason": {
        "type": "string",
        "enum": [
          "caller_requested",
          "task_completed",
          "no_response"
        ]
      },
      "destination": {
        "type": "string",
        "enum": [
          "main",
          "school",
          "options"
        ],
        "description": "Explicit SpeakCall telephone navigation only; omit to end normally."
      }
    },
    "required": [
      "reason"
    ]
  }
};

export const TRANSLATION_LANGUAGE_TOOL = {
  "name": "save_translation_language",
  "description": "Remember an explicitly requested target language for this and future translation calls.",
  "parameters": {
    "type": "object",
    "properties": {
      "language": {
        "type": "string",
        "enum": [
          "auto",
          "English",
          "Hebrew",
          "Yiddish",
          "Arabic",
          "Russian",
          "French"
        ],
        "description": "Use auto to restore automatic Hebrew/English translation."
      }
    },
    "required": [
      "language"
    ]
  }
};
