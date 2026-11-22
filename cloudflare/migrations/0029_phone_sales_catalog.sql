UPDATE console_records SET body=json_set(body,
  '$.minutes',CASE id WHEN 'school-step' THEN 60 WHEN 'school-pace' THEN 200 WHEN 'school-fluent' THEN 300 ELSE 150 END,
  '$.phone_enabled',json('true'),
  '$.recommended',json(CASE id WHEN 'school-fluent' THEN 'true' ELSE 'false' END),
  '$.tagline',CASE id
    WHEN 'school-step' THEN 'צעד ראשון לדיבור'
    WHEN 'school-pace' THEN 'מתחילים לדבר באמת'
    WHEN 'school-fluent' THEN 'אימון יומי ארוך לקצב מהיר ותוצאות'
    WHEN 'school-foundations' THEN 'אימון בכל יום לבניית בסיס חזק'
    ELSE 'אימון בכל יום עם אוצר מילים מתקדם ותחום לבחירה, עד שליטה וביטחון' END,
  '$.max_payments',CASE id WHEN 'school-foundations' THEN 6 WHEN 'school-mastery' THEN 12 ELSE 1 END)
WHERE kind='packages' AND id IN ('school-step','school-pace','school-fluent','school-foundations','school-mastery');
UPDATE console_records SET body=json_set(body,'$.name','תוספת זמן שיחה') WHERE kind='packages' AND id='school-topup';
UPDATE plans SET name='תוספת זמן שיחה' WHERE id='school-topup';
UPDATE plans SET included_minutes=CASE id WHEN 'school-step' THEN 60 WHEN 'school-pace' THEN 200 WHEN 'school-fluent' THEN 300 ELSE 150 END
WHERE id IN ('school-step','school-pace','school-fluent','school-foundations','school-mastery');
