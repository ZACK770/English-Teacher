CREATE TABLE pirsumfon_pings (
  sequence INTEGER PRIMARY KEY,
  call_hash TEXT NOT NULL UNIQUE
);
