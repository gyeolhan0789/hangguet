package com.ssafy.a301.company.service;

import com.ssafy.a301.company.domain.CompanyCard;
import com.ssafy.a301.company.repository.CompanyCardRepository;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/**
 * 지원서 회사명으로 회사의 최신 카드를 찾는다(docs/ERD-회사카드.md 회사 매칭 규칙). 별칭은 파이프라인이 정규화해 올리므로 같은 규칙(파이프라인
 * candidates.key)으로 회사명을 맞춘 뒤 별칭과 같은 행을 찾는다.
 */
@Service
public class CompanyCardFinder {
    // 파이프라인 candidates._DROP과 같다. 파이썬 정규식처럼 대소문자 무시·공백을 유니코드 기준으로 본다.
    // 회사 형태 표기를 먼저 빼고 남은 글에서 공백·문장부호를 뺀다(한 식으로 빼는 것과 결과가 같다).
    // 표기 뒤의 마침표(Ltd. · Corp. · Inc.)는 두 번째 단계에서 빠진다
    private static final Pattern DROP_WORDS =
            Pattern.compile(
                    "\\(주\\)|㈜|주식회사|co\\.?,?\\.?\\s*ltd|corp(oration)?|inc",
                    Pattern.CASE_INSENSITIVE
                            | Pattern.UNICODE_CASE
                            | Pattern.UNICODE_CHARACTER_CLASS
                            | Pattern.CANON_EQ);
    private static final Pattern DROP_MARKS =
            Pattern.compile(
                    "[\\s.,·\\-]",
                    Pattern.CASE_INSENSITIVE
                            | Pattern.UNICODE_CASE
                            | Pattern.UNICODE_CHARACTER_CLASS);

    private final CompanyCardRepository cards;

    public CompanyCardFinder(CompanyCardRepository cards) {
        this.cards = cards;
    }

    /** 회사를 찾지 못했거나 그 회사에 카드가 없으면 비어 있다 */
    public Optional<CompanyCard> findCurrent(String companyName) {
        String alias = normalize(companyName);
        if (alias.isEmpty()) {
            return Optional.empty();
        }
        return cards.findCurrentByAlias(alias);
    }

    /** 띄어쓰기·문장부호·(주)·Co., Ltd 등을 빼고 소문자로 */
    static String normalize(String companyName) {
        String withoutWords = DROP_WORDS.matcher(companyName).replaceAll("");
        return DROP_MARKS.matcher(withoutWords).replaceAll("").toLowerCase(Locale.ROOT);
    }
}
