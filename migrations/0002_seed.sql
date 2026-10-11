-- Sample values set, all from Pukui's ʻŌlelo Noʻeau.
-- These are placeholders. Confirm with Noʻeau and replace them with the Hui's own values.

INSERT INTO value_sets (id, name) VALUES (1, 'Sample values (replace with the Hui''s own)');

INSERT INTO "values" (values_set_id, ord, name_haw, name_en, olelo_noeau, olelo_noeau_meaning, description) VALUES
(1, 1, 'Laulima', 'Working together',
  'ʻAʻohe hana nui ke alu ʻia.', 'No task is too big when done together by all.',
  'Sharing the load, pitching in without being asked, making room for others to help.'),
(1, 2, 'Aloha ʻĀina', 'Love and care for the land',
  'He aliʻi ka ʻāina, he kauwā ke kanaka.', 'The land is chief, people are its servants.',
  'Putting the needs of the ʻāina first and caring for it in small daily ways.'),
(1, 3, 'Ma ka hana ka ʻike', 'Learning by doing',
  'Ma ka hana ka ʻike.', 'In working one learns.',
  'Trying things with your hands, learning from mistakes, teaching by showing.'),
(1, 4, 'Kūlia', 'Striving',
  'Kūlia i ka nuʻu.', 'Strive for the summit.',
  'Reaching for the best you can do and helping others reach too.'),
(1, 5, 'Pilina', 'Relationships',
  'ʻIke aku, ʻike mai, kōkua aku, kōkua mai, pēlā ihola ka nohona ʻohana.',
  'Recognize others, be recognized, help others, be helped, that is family life.',
  'Building trust with coworkers, partners, and community, and keeping it.'),
(1, 6, 'Haʻahaʻa', 'Humility and openness',
  'ʻAʻohe pau ka ʻike i ka hālau hoʻokahi.', 'Not all knowledge comes from one school.',
  'Listening first, staying open to other ways of knowing, owning mistakes.');

INSERT INTO settings (key, value) VALUES
  ('hui_name', 'the Hui'),
  ('director_name', 'your director'),
  ('moon_calendar', 'on'),
  ('reminder_channel', 'manual'),
  ('five_minute_count', '2');
