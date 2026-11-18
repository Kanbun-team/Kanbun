-- Full-text search over cards (titles, descriptions, comment bodies).
-- CardSearch is an FTS5 table that Prisma does not model: query it with
-- $queryRaw (see src/server/search-actions.ts). One row per card.
--
-- The unicode61 tokenizer folds combining diacritics (ą, ę, ó, ś, ż, ü, è...)
-- but not letters that have no Unicode decomposition, like the Polish ł.
-- "folded" repeats the card's text with ł/Ł replaced by l/L, only for cards
-- that contain them, so "zrodel" also finds "źródeł".
--
-- Triggers rebuild a card's row whenever the card or one of its comments
-- changes. That covers cards and comments recreated by trash restore (original
-- ids, inserted card first and comments after) and cascading deletes.
--
-- If a later Prisma migration redefines TaskCard or TaskCardComment
-- (CREATE new_..., copy, DROP, RENAME), SQLite drops these triggers together
-- with the old table. Such a migration must recreate them and rebuild the index.
-- `prisma migrate dev` also does not know these tables and will add
-- DROP TABLE "CardSearch..." statements to new migrations: delete those lines.

CREATE VIRTUAL TABLE "CardSearch" USING fts5(
    "cardId" UNINDEXED,
    "title",
    "description",
    "comments",
    "folded",
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER "CardSearch_card_insert" AFTER INSERT ON "TaskCard" BEGIN
    DELETE FROM "CardSearch" WHERE "cardId" = new."id";
    INSERT INTO "CardSearch" ("cardId", "title", "description", "comments", "folded")
    SELECT "id", "title", "description", "comments",
        CASE WHEN instr("t", 'ł') > 0 OR instr("t", 'Ł') > 0 THEN replace(replace("t", 'ł', 'l'), 'Ł', 'L') ELSE '' END
    FROM (
        SELECT *, "title" || char(10) || "description" || char(10) || "comments" AS "t"
        FROM (
            SELECT c."id", c."title", coalesce(c."description", '') AS "description",
                coalesce((SELECT group_concat(m."body", char(10)) FROM "TaskCardComment" m WHERE m."cardId" = c."id"), '') AS "comments"
            FROM "TaskCard" c WHERE c."id" = new."id"
        )
    );
END;

CREATE TRIGGER "CardSearch_card_update" AFTER UPDATE OF "id", "title", "description" ON "TaskCard" BEGIN
    DELETE FROM "CardSearch" WHERE "cardId" = old."id" OR "cardId" = new."id";
    INSERT INTO "CardSearch" ("cardId", "title", "description", "comments", "folded")
    SELECT "id", "title", "description", "comments",
        CASE WHEN instr("t", 'ł') > 0 OR instr("t", 'Ł') > 0 THEN replace(replace("t", 'ł', 'l'), 'Ł', 'L') ELSE '' END
    FROM (
        SELECT *, "title" || char(10) || "description" || char(10) || "comments" AS "t"
        FROM (
            SELECT c."id", c."title", coalesce(c."description", '') AS "description",
                coalesce((SELECT group_concat(m."body", char(10)) FROM "TaskCardComment" m WHERE m."cardId" = c."id"), '') AS "comments"
            FROM "TaskCard" c WHERE c."id" = new."id"
        )
    );
END;

CREATE TRIGGER "CardSearch_card_delete" AFTER DELETE ON "TaskCard" BEGIN
    DELETE FROM "CardSearch" WHERE "cardId" = old."id";
END;

CREATE TRIGGER "CardSearch_comment_insert" AFTER INSERT ON "TaskCardComment" BEGIN
    DELETE FROM "CardSearch" WHERE "cardId" = new."cardId";
    INSERT INTO "CardSearch" ("cardId", "title", "description", "comments", "folded")
    SELECT "id", "title", "description", "comments",
        CASE WHEN instr("t", 'ł') > 0 OR instr("t", 'Ł') > 0 THEN replace(replace("t", 'ł', 'l'), 'Ł', 'L') ELSE '' END
    FROM (
        SELECT *, "title" || char(10) || "description" || char(10) || "comments" AS "t"
        FROM (
            SELECT c."id", c."title", coalesce(c."description", '') AS "description",
                coalesce((SELECT group_concat(m."body", char(10)) FROM "TaskCardComment" m WHERE m."cardId" = c."id"), '') AS "comments"
            FROM "TaskCard" c WHERE c."id" = new."cardId"
        )
    );
END;

CREATE TRIGGER "CardSearch_comment_update" AFTER UPDATE OF "body", "cardId" ON "TaskCardComment" BEGIN
    DELETE FROM "CardSearch" WHERE "cardId" = old."cardId" OR "cardId" = new."cardId";
    INSERT INTO "CardSearch" ("cardId", "title", "description", "comments", "folded")
    SELECT "id", "title", "description", "comments",
        CASE WHEN instr("t", 'ł') > 0 OR instr("t", 'Ł') > 0 THEN replace(replace("t", 'ł', 'l'), 'Ł', 'L') ELSE '' END
    FROM (
        SELECT *, "title" || char(10) || "description" || char(10) || "comments" AS "t"
        FROM (
            SELECT c."id", c."title", coalesce(c."description", '') AS "description",
                coalesce((SELECT group_concat(m."body", char(10)) FROM "TaskCardComment" m WHERE m."cardId" = c."id"), '') AS "comments"
            FROM "TaskCard" c WHERE c."id" = old."cardId" OR c."id" = new."cardId"
        )
    );
END;

CREATE TRIGGER "CardSearch_comment_delete" AFTER DELETE ON "TaskCardComment" BEGIN
    DELETE FROM "CardSearch" WHERE "cardId" = old."cardId";
    INSERT INTO "CardSearch" ("cardId", "title", "description", "comments", "folded")
    SELECT "id", "title", "description", "comments",
        CASE WHEN instr("t", 'ł') > 0 OR instr("t", 'Ł') > 0 THEN replace(replace("t", 'ł', 'l'), 'Ł', 'L') ELSE '' END
    FROM (
        SELECT *, "title" || char(10) || "description" || char(10) || "comments" AS "t"
        FROM (
            SELECT c."id", c."title", coalesce(c."description", '') AS "description",
                coalesce((SELECT group_concat(m."body", char(10)) FROM "TaskCardComment" m WHERE m."cardId" = c."id"), '') AS "comments"
            FROM "TaskCard" c WHERE c."id" = old."cardId"
        )
    );
END;

-- Backfill existing cards.
INSERT INTO "CardSearch" ("cardId", "title", "description", "comments", "folded")
SELECT "id", "title", "description", "comments",
    CASE WHEN instr("t", 'ł') > 0 OR instr("t", 'Ł') > 0 THEN replace(replace("t", 'ł', 'l'), 'Ł', 'L') ELSE '' END
FROM (
    SELECT *, "title" || char(10) || "description" || char(10) || "comments" AS "t"
    FROM (
        SELECT c."id", c."title", coalesce(c."description", '') AS "description",
            coalesce((SELECT group_concat(m."body", char(10)) FROM "TaskCardComment" m WHERE m."cardId" = c."id"), '') AS "comments"
        FROM "TaskCard" c
    )
);
