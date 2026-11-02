package com.ssafy.a301.company.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.springframework.data.domain.Persistable;

/** 적재를 마친 manifest 실행(PK = run_id). 같은 실행은 다시 적재하지 않는다. 개발·운영이 각자 DB에 남긴다. */
@Entity
@Table(name = "company_card_imports")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CompanyCardImport implements Persistable<String> {
    public static final int MAX_RUN_ID_LENGTH = 50;

    @Id
    @Column(name = "run_id", length = MAX_RUN_ID_LENGTH)
    private String runId;

    @CreationTimestamp
    @Column(name = "imported_at", nullable = false, updatable = false)
    private OffsetDateTime importedAt;

    public CompanyCardImport(String runId) {
        this.runId = runId;
    }

    @Override
    public String getId() {
        return runId;
    }

    // id를 직접 정하므로 저장 전인지는 기록 일시로 가린다(save가 merge 대신 persist하게)
    @Override
    public boolean isNew() {
        return importedAt == null;
    }
}
