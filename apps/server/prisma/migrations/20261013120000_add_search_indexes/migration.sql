CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "searchVector" tsvector;

UPDATE "Message"
SET "searchVector" = to_tsvector('simple', COALESCE(body, ''))
WHERE "searchVector" IS NULL;

CREATE OR REPLACE FUNCTION message_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW."searchVector" := to_tsvector('simple', COALESCE(NEW.body, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS message_search_vector_trigger ON "Message";
CREATE TRIGGER message_search_vector_trigger
BEFORE INSERT OR UPDATE OF body ON "Message"
FOR EACH ROW
EXECUTE FUNCTION message_search_vector_update();

CREATE INDEX IF NOT EXISTS "Message_searchVector_idx"
ON "Message" USING GIN ("searchVector");

CREATE INDEX IF NOT EXISTS "Message_body_trgm_idx"
ON "Message" USING GIN (body gin_trgm_ops);