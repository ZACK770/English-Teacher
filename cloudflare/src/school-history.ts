// Historical navigation data stays in D1, but does not belong in school history.
// Resolve the bot through call metadata, never through a customer's student_id.
const retiredBots = "(SELECT id FROM bots WHERE role='navigation' UNION SELECT 'voice-navigator-live')";

// The caller supplies the fixed alias `c` for call_customers.
export const SCHOOL_CALL_FILTER = `c.bot_id NOT IN ${retiredBots}`;

export const SCHOOL_SESSION_FILTER = `
  NOT EXISTS (SELECT 1 FROM call_customers c
    WHERE c.call_id=sessions.call_id AND NOT (${SCHOOL_CALL_FILTER}))
  AND NOT EXISTS (SELECT 1 FROM prompt_snapshots p
    WHERE p.call_id=sessions.call_id AND p.profile_id IN ${retiredBots})`;
