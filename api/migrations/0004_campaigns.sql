ALTER TABLE event ADD COLUMN creator_id TEXT REFERENCES user(id);
ALTER TABLE event ADD COLUMN kind TEXT NOT NULL DEFAULT 'map' CHECK(kind IN ('map','code','qr','puzzle','prize'));
ALTER TABLE event ADD COLUMN single_claim INTEGER NOT NULL DEFAULT 1 CHECK(single_claim IN (0,1));
ALTER TABLE event ADD COLUMN funding_wallet_id TEXT;
ALTER TABLE event ADD COLUMN funding_address TEXT;
CREATE TABLE drop_proof (spot_id TEXT PRIMARY KEY REFERENCES spot(id), proof_hash TEXT, secret TEXT, clue TEXT NOT NULL DEFAULT '', recipient_email TEXT);
DROP INDEX claim_account_event;
CREATE UNIQUE INDEX claim_account_drop ON claim(user_id,spot_id) WHERE status != 'failed';
CREATE TRIGGER campaign_claim_limit BEFORE INSERT ON claim WHEN NEW.status != 'failed' BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM event WHERE id = NEW.event_id AND single_claim = 1)
    AND EXISTS (SELECT 1 FROM claim WHERE user_id = NEW.user_id AND event_id = NEW.event_id AND status != 'failed')
    THEN RAISE(ABORT, 'CAMPAIGN_ALREADY_CLAIMED') END;
END;
CREATE TABLE wallet_lock (user_id TEXT PRIMARY KEY REFERENCES user(id), operation_id TEXT NOT NULL UNIQUE);
CREATE TABLE spend (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id), recipient TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), fee TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, transaction_id TEXT UNIQUE, transaction_hash TEXT, status TEXT NOT NULL CHECK(status IN ('quoted','pending','confirmed','failed')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT);
CREATE INDEX spend_pending ON spend(status,updated_at);
ALTER TABLE event ADD COLUMN funding_fee TEXT;
ALTER TABLE event ADD COLUMN funding_quote_id TEXT;
ALTER TABLE event ADD COLUMN funding_quote_at INTEGER;
