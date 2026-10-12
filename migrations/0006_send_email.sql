-- Email goes only to people with this checked in People. On for everyone to start; uncheck anyone who should not get email.
ALTER TABLE staff ADD COLUMN send_email INTEGER NOT NULL DEFAULT 1;
