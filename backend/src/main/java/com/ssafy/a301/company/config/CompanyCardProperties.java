package com.ssafy.a301.company.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 회사 카드 적재(docs/ERD-회사카드.md). bucket은 파이프라인이 카드를 올리는 공용 버킷이고, 비어 있으면(로컬·테스트) 적재하지 않는다. 최신이 아닌 카드는
 * keep이 지나고 어느 면접도 쓰지 않으면 지운다.
 */
@ConfigurationProperties("company-card")
public record CompanyCardProperties(String bucket, Duration keep) {
    public CompanyCardProperties {
        if (keep == null || keep.isNegative() || keep.isZero()) {
            throw new IllegalArgumentException("company-card.keep must be positive");
        }
    }

    public boolean enabled() {
        return bucket != null && !bucket.isBlank();
    }
}
