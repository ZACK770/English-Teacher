CREATE TABLE learning_lessons (
  customer_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (customer_id, call_id)
);
CREATE TABLE learning_targets (
  customer_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('vocabulary','grammar')),
  target_id TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (customer_id, kind, target_id)
);
CREATE TABLE learning_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (customer_id, call_id, activity_id),
  FOREIGN KEY (customer_id, call_id) REFERENCES learning_lessons(customer_id, call_id)
);
CREATE TABLE learning_results (
  customer_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('vocabulary','grammar')),
  target_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK(score IN (0,50,100)),
  PRIMARY KEY (customer_id, call_id, activity_id, kind, target_id),
  FOREIGN KEY (customer_id, call_id, activity_id) REFERENCES learning_batches(customer_id, call_id, activity_id),
  FOREIGN KEY (customer_id, kind, target_id) REFERENCES learning_targets(customer_id, kind, target_id)
);
CREATE INDEX learning_results_target ON learning_results(customer_id, kind, target_id);
CREATE TABLE learning_exposures (
  customer_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  count INTEGER NOT NULL CHECK(count >= 0),
  PRIMARY KEY(customer_id, call_id, target_id),
  FOREIGN KEY(customer_id, call_id) REFERENCES learning_lessons(customer_id, call_id)
);
