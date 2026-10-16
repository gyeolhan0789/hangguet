package com.ssafy.a301.home.domain;

import com.ssafy.a301.user.domain.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

/** 연습 기록. 연습 면접(답변 1개 이상으로 끝난 면접)이 있는 날 회원별 하루 한 건. 면접 끝내기(5.8)에서 그날 첫 연습일 때만 넣는다. */
@Entity
@Table(
        name = "practice_logs",
        uniqueConstraints =
                @UniqueConstraint(
                        name = "uk_practice_logs_user_date",
                        columnNames = {"user_id", "practice_date"}))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PracticeLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    // 한국 시간 기준 날짜
    @Column(name = "practice_date", nullable = false)
    private LocalDate practiceDate;

    // 그날 처음 면접을 마친 일시
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public PracticeLog(User user, LocalDate practiceDate) {
        this.user = user;
        this.practiceDate = practiceDate;
    }
}
