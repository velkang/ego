CREATE TRIGGER validate_claim BEFORE INSERT ON claim BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM event JOIN spot ON spot.event_id = event.id
    WHERE event.id = NEW.event_id AND spot.id = NEW.spot_id
      AND event.status = 'active' AND event.starts_at <= NEW.created_at AND event.ends_at > NEW.created_at
      AND spot.amount = NEW.amount
  ) THEN RAISE(ABORT, 'EVENT_UNAVAILABLE') END;
END;
