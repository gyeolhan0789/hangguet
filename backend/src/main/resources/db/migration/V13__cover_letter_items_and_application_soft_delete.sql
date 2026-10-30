-- 자기소개서를 문항 단위로 저장하고(ERD cover_letter_items), 지원서는 지워도 행을 남긴다(ERD applications.deleted_at).
-- 지운 지원서로 본 면접 기록(interview_sessions.application_id)과 그 결과·다시보기가 그대로 남게 하기 위해서다.
-- 문항은 지원서당 1~5개, 질문 1~255자, 답변 1~20,000자(API 명세 4.1). 순서는 item_order(1부터)로 둔다.
-- 이미 있는 지원서는 자기소개서 글 전체를 1번 문항('자기소개서')의 답변으로 옮긴다.
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '13' 행을 지운다.
--   ALTER TABLE applications ADD COLUMN cover_letter TEXT;
--   -- V13이 옮긴 지원서('자기소개서' 문항 하나뿐)는 원래 글 그대로, 나머지는 문항을 순서대로 이어 붙인다.
--   UPDATE applications a SET cover_letter = (
--       SELECT CASE WHEN count(*) = 1 AND min(i.question) = '자기소개서' THEN min(i.answer)
--                   ELSE string_agg(i.question || E'\n' || i.answer, E'\n\n' ORDER BY i.item_order) END
--       FROM cover_letter_items i WHERE i.application_id = a.id);
--   ALTER TABLE applications ALTER COLUMN cover_letter SET NOT NULL;
--   ALTER TABLE applications DROP COLUMN deleted_at;
--   DROP TABLE cover_letter_items;
-- 되돌리면 지운 지원서(deleted_at이 있던 행)도 다시 보인다.

CREATE TABLE cover_letter_items (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    application_id BIGINT       NOT NULL REFERENCES applications (id),
    item_order     INT          NOT NULL,
    question       VARCHAR(255) NOT NULL,
    answer         TEXT         NOT NULL,
    CONSTRAINT ck_cover_letter_items_item_order CHECK (item_order BETWEEN 1 AND 5),
    CONSTRAINT uk_cover_letter_items_application_order UNIQUE (application_id, item_order)
);

INSERT INTO cover_letter_items (application_id, item_order, question, answer)
SELECT id, 1, '자기소개서', cover_letter FROM applications;

ALTER TABLE applications DROP COLUMN cover_letter;
ALTER TABLE applications ADD COLUMN deleted_at TIMESTAMPTZ;
