ALTER TABLE callback_requests ADD COLUMN next_attempt_at TEXT;
UPDATE callback_requests SET status = 'expired', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status = 'queued' AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days');
UPDATE callback_requests SET next_attempt_at = created_at WHERE status = 'queued';
CREATE INDEX callback_requests_schedule ON callback_requests (status, next_attempt_at);
