UPDATE console_records
SET body=json_set(body,'$.opening_seconds',420), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE kind='policies' AND json_extract(body,'$.product')='school' AND json_extract(body,'$.opening_seconds')=600;
