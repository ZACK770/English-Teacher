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
          "translator",
          "options"
        ],
        "description": "Explicit Dibura telephone navigation only; omit to end normally."
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

export const ROUTE_TOOL = {
  "name": "get_driving_route",
  "description": "Get a live, traffic-aware driving route from Google Maps between two places in Israel. Call it when the destination is known and again after the driver reports a new location or a missed turn. Returns distance, minutes with traffic and turn steps.",
  "parameters": {
    "type": "object",
    "properties": {
      "origin": {
        "type": "string",
        "description": "Driver's current location as an address, junction or landmark with city, in Hebrew."
      },
      "destination": {
        "type": "string",
        "description": "Destination address or place with city, in Hebrew."
      }
    },
    "required": [
      "origin",
      "destination"
    ]
  }
};

export const NAV_TOOL = {
  "name": "navigation_update",
  "description": "The navigation engine; it remembers the whole trip (route, position, heading, what the driver reported). Call it EVERY time the driver gives a destination, reports where he is, what he sees, a turn he made (also a mistaken one), the road he is on, the odometer, answers a direction question, or asks for the full route. Classify the report correctly and never invent facts the driver did not say. Say the returned 'say' (and 'then') exactly; never change left/right, ordinals, exits or distances. If 'ask' is returned, ask exactly that and give no other directions.",
  "parameters": {
    "type": "object",
    "properties": {
      "report": {
        "type": "string",
        "enum": [
          "at",
          "see",
          "passed",
          "turned",
          "on_road"
        ],
        "description": "at=I am at/next to; see=I see a sign/street ahead (not reached); passed=I just passed it and continue; turned=I made a turn onto a street/road; on_road=I am on road X toward Y."
      },
      "place": {
        "type": "string",
        "description": "Place/street/landmark the driver named, in Hebrew with city, e.g. 'רבי עקיבא 22, בני ברק'."
      },
      "turn": {
        "type": "string",
        "enum": [
          "left",
          "right",
          "uturn",
          "straight"
        ],
        "description": "For report=turned: the side the driver said."
      },
      "road": {
        "type": "string",
        "description": "For turned/on_road: street name or road number the driver is now on, e.g. 'כביש 1' or 'ז׳בוטינסקי'."
      },
      "toward": {
        "type": "string",
        "description": "Direction city on the sign, e.g. 'תל אביב', when the driver said it."
      },
      "destination": {
        "type": "string",
        "description": "Destination with city, in Hebrew. Only when given or changed."
      },
      "odometer_km": {
        "type": "number",
        "description": "Trip-odometer reading in km."
      },
      "direction": {
        "type": "string",
        "enum": [
          "confirmed",
          "opposite"
        ],
        "description": "Only when the driver himself answered a direction question."
      },
      "driver_words": {
        "type": "string",
        "description": "The driver's exact words in this turn, in Hebrew."
      },
      "full_route": {
        "type": "boolean",
        "description": "True when the driver asks for all remaining turns; read them from 'full_route'."
      }
    }
  }
};
