ALTER TABLE event ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX event_slug ON event(slug);

UPDATE event SET title = 'Garden gathering', description = 'Find drops around Freedom Park.'
WHERE id = 'a1111111-1111-4111-8111-111111111111';
