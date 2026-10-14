ALTER TABLE operation ADD COLUMN funding_quote_id TEXT;
-- Keep trigger bodies on one line for D1's remote statement parser.
CREATE TRIGGER bind_funding_quote BEFORE INSERT ON operation WHEN NEW.action = 'launch' AND EXISTS (SELECT 1 FROM event WHERE id = NEW.event_id AND creator_id IS NOT NULL) BEGIN SELECT RAISE(ABORT, 'QUOTE_EXPIRED') WHERE NOT EXISTS (SELECT 1 FROM event WHERE id = NEW.event_id AND status = 'draft' AND funding_quote_id = NEW.funding_quote_id AND funding_fee IS NOT NULL AND funding_quote_at >= NEW.created_at - 60000); END;
