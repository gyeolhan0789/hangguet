-- 문의 첨부 사진(API 명세 9.1 · 9.4 · 9.11). 한 행이 메시지에 붙인 사진 한 장이다.
-- 되돌리기(Rollback): 아래를 실행하고 flyway_schema_history에서 version '17' 행을 지운다. S3에 올린 사진은 지우지 않는다.
--   DROP TABLE inquiry_attachments;

CREATE TABLE inquiry_attachments (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id   BIGINT       NOT NULL REFERENCES inquiry_messages (id),
    object_key   VARCHAR(500) NOT NULL,
    content_type VARCHAR(50)  NOT NULL,
    size         BIGINT       NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL,
    CONSTRAINT uk_inquiry_attachments_object_key UNIQUE (object_key)
);
CREATE INDEX ix_inquiry_attachments_message ON inquiry_attachments (message_id);
