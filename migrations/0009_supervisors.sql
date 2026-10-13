-- Supervisors (alakaʻi): who each person reports to, and the letters the director chooses to share with them.
ALTER TABLE staff ADD COLUMN reports_to INTEGER REFERENCES staff(id);
ALTER TABLE summaries ADD COLUMN supervisor_body TEXT;
ALTER TABLE summaries ADD COLUMN supervisor_shared_at TEXT;
