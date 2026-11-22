UPDATE console_records SET body=json_set(body,'$.duration_months',
  CASE id WHEN 'school-foundations' THEN 6 ELSE 12 END)
WHERE kind='packages' AND id IN ('school-foundations','school-mastery');
