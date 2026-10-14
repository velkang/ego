ALTER TABLE operation ADD COLUMN funding_quote_id TEXT;
CREATE TRIGGER bind_funding_quote BEFORE INSERT ON operation
WHEN NEW.action = 'launch' AND EXISTS (SELECT 1 FROM event WHERE id = NEW.event_id AND creator_id IS NOT NULL)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM event WHERE id = NEW.event_id AND status = 'draft'
      AND funding_quote_id = NEW.funding_quote_id AND funding_fee IS NOT NULL
      AND funding_quote_at >= NEW.created_at - 60000
  ) THEN RAISE(ABORT, 'QUOTE_EXPIRED') END;
END;
