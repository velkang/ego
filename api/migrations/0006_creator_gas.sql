ALTER TABLE operation ADD COLUMN fee TEXT;
CREATE UNIQUE INDEX operation_reviewed_quote ON operation(funding_quote_id) WHERE funding_quote_id IS NOT NULL;
DROP TRIGGER bind_funding_quote;
-- Bind every creator-paid operation to its reviewed action and immutable fee snapshot.
CREATE TRIGGER bind_funding_quote BEFORE INSERT ON operation BEGIN SELECT RAISE(ABORT, 'QUOTE_EXPIRED') WHERE NOT EXISTS (SELECT 1 FROM event WHERE id = NEW.event_id AND creator_id IS NOT NULL AND funding_wallet_id IS NOT NULL AND funding_address IS NOT NULL AND funding_quote_id = NEW.funding_quote_id AND funding_fee = NEW.fee AND json_extract(funding_fee, '$.action') = NEW.action AND funding_quote_at >= NEW.created_at - 60000); END;
