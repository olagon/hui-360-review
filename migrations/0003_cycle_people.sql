-- Who is in each review. Self reflections and the reviewer grid use this list,
-- so a review can include some people and not others.
CREATE TABLE cycle_people (
  cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  PRIMARY KEY (cycle_id, staff_id)
);

-- Existing reviews keep everyone already assigned. A review with no assignments yet starts with everyone active.
INSERT OR IGNORE INTO cycle_people (cycle_id, staff_id)
  SELECT cycle_id, reviewer_id FROM assignments UNION SELECT cycle_id, reviewee_id FROM assignments;
INSERT OR IGNORE INTO cycle_people (cycle_id, staff_id)
  SELECT c.id, s.id FROM cycles c, staff s
  WHERE s.active = 1 AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.cycle_id = c.id);
