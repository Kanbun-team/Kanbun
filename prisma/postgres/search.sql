-- Full-text search over cards for PostgreSQL (the SQLite build uses FTS5,
-- see prisma/migrations/20261118100000_card_search). Hand-written: Prisma does
-- not model these objects. `npm run db:pg:baseline` appends this file to the
-- generated baseline migration, and `npm run db:pg:migration` strips any
-- statement Prisma proposes for them.
--
-- "CardSearch" holds one row per card: the description and the comment bodies
-- (for ts_headline snippets) and a weighted tsvector (title A, description B,
-- comments C). Triggers keep it current, like the SQLite triggers, including
-- for cards and comments recreated by trash restore.
--
-- The kanbun_search configuration runs every word through unaccent, so
-- "zrodel" finds "źródeł" and "cafe" finds "café". translate() also folds ł/Ł
-- in case a server's unaccent rules lack them.

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TEXT SEARCH CONFIGURATION kanbun_search (COPY = simple);
ALTER TEXT SEARCH CONFIGURATION kanbun_search
    ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;

CREATE TABLE "CardSearch" (
    "cardId" TEXT NOT NULL PRIMARY KEY REFERENCES "TaskCard"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "description" TEXT NOT NULL,
    "comments" TEXT NOT NULL,
    "document" tsvector NOT NULL
);

CREATE INDEX "CardSearch_document_idx" ON "CardSearch" USING GIN ("document");

CREATE FUNCTION kanbun_card_search_refresh(card_id TEXT) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM "CardSearch" WHERE "cardId" = card_id;
    INSERT INTO "CardSearch" ("cardId", "description", "comments", "document")
    SELECT
        c."id",
        coalesce(c."description", ''),
        coalesce(m."body", ''),
        setweight(to_tsvector('kanbun_search', translate(c."title", 'łŁ', 'lL')), 'A') ||
        setweight(to_tsvector('kanbun_search', translate(coalesce(c."description", ''), 'łŁ', 'lL')), 'B') ||
        setweight(to_tsvector('kanbun_search', translate(coalesce(m."body", ''), 'łŁ', 'lL')), 'C')
    FROM "TaskCard" c
    LEFT JOIN LATERAL (
        SELECT string_agg(x."body", E'\n' ORDER BY x."createdAt", x."id") AS "body"
        FROM "TaskCardComment" x
        WHERE x."cardId" = c."id"
    ) m ON true
    WHERE c."id" = card_id;
END;
$$;

CREATE FUNCTION kanbun_card_search_card_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD."id" <> NEW."id" THEN
        PERFORM kanbun_card_search_refresh(OLD."id");
    END IF;
    PERFORM kanbun_card_search_refresh(NEW."id");
    RETURN NULL;
END;
$$;

CREATE FUNCTION kanbun_card_search_comment_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM kanbun_card_search_refresh(OLD."cardId");
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR OLD."cardId" <> NEW."cardId") THEN
        PERFORM kanbun_card_search_refresh(NEW."cardId");
    END IF;
    RETURN NULL;
END;
$$;

-- Card deletes cascade to "CardSearch" through the foreign key.
CREATE TRIGGER "CardSearch_card_change"
    AFTER INSERT OR UPDATE OF "id", "title", "description" ON "TaskCard"
    FOR EACH ROW EXECUTE FUNCTION kanbun_card_search_card_trigger();

CREATE TRIGGER "CardSearch_comment_change"
    AFTER INSERT OR UPDATE OF "body", "cardId" OR DELETE ON "TaskCardComment"
    FOR EACH ROW EXECUTE FUNCTION kanbun_card_search_comment_trigger();

-- Backfill (empty on a fresh database, filled after scripts/sqlite-to-postgres.ts
-- copies rows in because the triggers run for every inserted row).
SELECT kanbun_card_search_refresh("id") FROM "TaskCard";
