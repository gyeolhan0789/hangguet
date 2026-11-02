package com.ssafy.a301.company.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.LocalDate;
import java.util.List;

/**
 * 파이프라인이 카드를 모두 올린 뒤 마지막에 쓰는 manifest.json(company-pipeline/pipeline/README.md 카드 올리기). format이 바뀌면
 * 칸 뜻이 바뀐 것이라 적재하지 않는다.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record CompanyCardManifest(
        int format, @JsonProperty("run_id") String runId, List<Entry> companies) {
    public static final int FORMAT = 1;

    /** 회사 하나. aliases는 파이프라인이 정규화한 이름, sha256은 card_key 파일 내용의 해시다 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Entry(
            @JsonProperty("corp_code") String corpCode,
            String name,
            @JsonProperty("is_listed") boolean listed,
            List<String> aliases,
            @JsonProperty("generated_at") LocalDate generatedAt,
            @JsonProperty("card_key") String cardKey,
            String sha256) {}
}
