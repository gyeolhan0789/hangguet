package com.ssafy.a301.interview.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

class CriterionTest {

    @Test
    void coversAllOnceWhenEachCriterionAppearsOnce() {
        assertThat(Criterion.coversAllOnce(List.of(Criterion.values()))).isTrue();
        assertThat(
                        Criterion.coversAllOnce(
                                List.of(
                                        Criterion.DELIVERY,
                                        Criterion.LOGIC,
                                        Criterion.COVER_LETTER,
                                        Criterion.JOB_FIT)))
                .isTrue();
    }

    @Test
    void doesNotCoverWhenMissingDuplicatedOrNull() {
        assertThat(Criterion.coversAllOnce(List.of())).isFalse();
        assertThat(
                        Criterion.coversAllOnce(
                                List.of(
                                        Criterion.JOB_FIT,
                                        Criterion.COVER_LETTER,
                                        Criterion.LOGIC)))
                .isFalse();
        assertThat(
                        Criterion.coversAllOnce(
                                List.of(
                                        Criterion.JOB_FIT,
                                        Criterion.JOB_FIT,
                                        Criterion.LOGIC,
                                        Criterion.DELIVERY)))
                .isFalse();
        assertThat(
                        Criterion.coversAllOnce(
                                Arrays.asList(
                                        Criterion.JOB_FIT,
                                        Criterion.COVER_LETTER,
                                        Criterion.LOGIC,
                                        Criterion.DELIVERY,
                                        null)))
                .isFalse();
    }
}
