-- 회사 카드 ERD (ERDCloud 가져오기용, MySQL 문법, 팀 ERD 규칙). 설명은 ERD-회사카드.md
-- 규칙: 종류 값은 코드값 + 그룹코드(고정값) 두 칸 → 공통코드 FK, 삭제는 소프트 삭제(deleted_at·is_deleted)
-- ERDCloud: 상단 메뉴 [Import] → 이 파일 내용 붙여넣기
-- common_codes는 팀 공통코드 테이블 자리표시. 실제 테이블 이름·컬럼으로 바꿀 것

CREATE TABLE common_codes (
    code_group  VARCHAR(50)  NOT NULL COMMENT '그룹코드',
    code        VARCHAR(50)  NOT NULL COMMENT '코드',
    name        VARCHAR(100) NOT NULL COMMENT '코드명',
    PRIMARY KEY (code_group, code)
) COMMENT = '공통코드';

-- ===== 메인 DB: BE가 읽는 테이블 (합의 필요) =====

CREATE TABLE companies (
    id                   INT          NOT NULL AUTO_INCREMENT COMMENT '회사ID',
    corp_code            VARCHAR(8)   NOT NULL COMMENT 'DART고유번호',
    name                 VARCHAR(100) NOT NULL COMMENT '회사명',
    is_listed            BOOLEAN      NOT NULL COMMENT '상장여부',
    news_query           VARCHAR(100) NULL     COMMENT '기사검색어',
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',
    deleted_at           DATETIME     NULL     COMMENT '삭제일시',
    is_deleted           BOOLEAN      NOT NULL DEFAULT FALSE COMMENT '삭제여부',
    PRIMARY KEY (id),
    UNIQUE KEY uk_companies_corp_code (corp_code)
) COMMENT = '회사';

CREATE TABLE company_aliases (
    id                   INT          NOT NULL AUTO_INCREMENT COMMENT '별칭ID',
    company_id           INT          NOT NULL COMMENT '회사',
    alias                VARCHAR(100) NOT NULL COMMENT '별칭',
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',
    deleted_at           DATETIME     NULL     COMMENT '삭제일시',
    is_deleted           BOOLEAN      NOT NULL DEFAULT FALSE COMMENT '삭제여부',
    PRIMARY KEY (id),
    UNIQUE KEY uk_company_aliases_alias (alias),
    CONSTRAINT fk_company_aliases_company FOREIGN KEY (company_id) REFERENCES companies (id)
) COMMENT = '회사별칭';

CREATE TABLE company_cards (
    id                   INT          NOT NULL AUTO_INCREMENT COMMENT '카드ID',
    company_id           INT          NOT NULL COMMENT '회사',
    prompt_version       VARCHAR(20)  NOT NULL COMMENT '프롬프트버전',
    model                VARCHAR(50)  NOT NULL COMMENT '모델',
    is_current           BOOLEAN      NOT NULL COMMENT '최신여부',
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',
    deleted_at           DATETIME     NULL     COMMENT '삭제일시',
    is_deleted           BOOLEAN      NOT NULL DEFAULT FALSE COMMENT '삭제여부',
    PRIMARY KEY (id),
    KEY ix_company_cards_company (company_id),
    CONSTRAINT fk_company_cards_company FOREIGN KEY (company_id) REFERENCES companies (id)
) COMMENT = '회사카드';

-- ===== 메인 DB: 파이프라인이 채우는 원문 (Python worker가 S3에서 적재) =====

CREATE TABLE source_documents (
    id                   INT          NOT NULL AUTO_INCREMENT COMMENT '원문ID',
    company_id           INT          NOT NULL COMMENT '회사',
    title                VARCHAR(255) NOT NULL COMMENT '원문제목',
    external_id          VARCHAR(100) NULL     COMMENT '외부식별자',
    url                  VARCHAR(500) NULL     COMMENT '원문링크',
    storage_key          VARCHAR(500) NULL     COMMENT '저장위치',
    published_at         DATE         NULL     COMMENT '공개일자',
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',
    deleted_at           DATETIME     NULL     COMMENT '삭제일시',
    document_type        VARCHAR(50)  NOT NULL COMMENT '원문유형',
    document_type_group  VARCHAR(50)  NOT NULL DEFAULT 'SOURCE_DOCUMENT_TYPE' COMMENT '원문유형그룹',
    is_deleted           BOOLEAN      NOT NULL DEFAULT FALSE COMMENT '삭제여부',
    PRIMARY KEY (id),
    KEY ix_source_documents_company_type (company_id, document_type),
    CONSTRAINT fk_source_documents_company FOREIGN KEY (company_id) REFERENCES companies (id),
    CONSTRAINT fk_source_documents_document_type FOREIGN KEY (document_type_group, document_type)
        REFERENCES common_codes (code_group, code)
) COMMENT = '원문기록';

CREATE TABLE news_articles (
    id                   INT          NOT NULL AUTO_INCREMENT COMMENT '기사ID',
    company_id           INT          NOT NULL COMMENT '회사',
    title                VARCHAR(300) NOT NULL COMMENT '기사제목',
    summary              TEXT         NULL     COMMENT '기사요약',
    url                  VARCHAR(500) NOT NULL COMMENT '기사링크',
    published_at         DATE         NOT NULL COMMENT '기사일자',
    event_group          INT          NULL     COMMENT '사건묶음번호',
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',
    deleted_at           DATETIME     NULL     COMMENT '삭제일시',
    is_deleted           BOOLEAN      NOT NULL DEFAULT FALSE COMMENT '삭제여부',
    PRIMARY KEY (id),
    UNIQUE KEY uk_news_articles_company_url (company_id, url),
    KEY ix_news_articles_company_published (company_id, published_at),
    CONSTRAINT fk_news_articles_company FOREIGN KEY (company_id) REFERENCES companies (id)
) COMMENT = '뉴스기사';

-- ===== 카드 항목 =====

CREATE TABLE company_card_items (
    id                   INT          NOT NULL AUTO_INCREMENT COMMENT '카드항목ID',
    card_id              INT          NOT NULL COMMENT '카드',
    seq                  INT          NOT NULL COMMENT '순서',
    summary              VARCHAR(255) NOT NULL COMMENT '요약',
    quote                TEXT         NOT NULL COMMENT '원문인용',
    source_document_id   INT          NULL     COMMENT '출처원문',
    news_article_id      INT          NULL     COMMENT '출처기사',
    article_count        INT          NULL     COMMENT '같은사건기사수',
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',
    deleted_at           DATETIME     NULL     COMMENT '삭제일시',
    item_type            VARCHAR(50)  NOT NULL COMMENT '항목유형',
    item_type_group      VARCHAR(50)  NOT NULL DEFAULT 'CARD_ITEM_TYPE' COMMENT '항목유형그룹',
    is_deleted           BOOLEAN      NOT NULL DEFAULT FALSE COMMENT '삭제여부',
    PRIMARY KEY (id),
    UNIQUE KEY uk_company_card_items_card_type_seq (card_id, item_type, seq),
    CONSTRAINT fk_company_card_items_card FOREIGN KEY (card_id) REFERENCES company_cards (id),
    CONSTRAINT fk_company_card_items_source_document FOREIGN KEY (source_document_id)
        REFERENCES source_documents (id),
    CONSTRAINT fk_company_card_items_news_article FOREIGN KEY (news_article_id)
        REFERENCES news_articles (id),
    CONSTRAINT fk_company_card_items_item_type FOREIGN KEY (item_type_group, item_type)
        REFERENCES common_codes (code_group, code)
) COMMENT = '회사카드항목';
