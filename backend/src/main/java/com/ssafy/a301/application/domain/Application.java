package com.ssafy.a301.application.domain;

import com.ssafy.a301.user.domain.User;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

/**
 * 지원서. 수정하지 않고, 지우면 deleted_at만 채운다(ERD applications). 지운 지원서로 본 면접 기록 · 결과 · 다시보기가 남아야 하기 때문이다.
 */
@Entity
@Table(name = "applications")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Application {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "company_name", nullable = false, length = 100)
    private String companyName;

    @Column(name = "job_title", nullable = false, length = 100)
    private String jobTitle;

    // 자기소개서 문항. 지원서와 함께 저장한다
    @OneToMany(mappedBy = "application", cascade = CascadeType.PERSIST)
    @OrderBy("itemOrder asc")
    private List<CoverLetterItem> coverLetterItems = new ArrayList<>();

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    // 지운 일시. 값이 없으면 남아 있는 지원서
    @Column(name = "deleted_at")
    private OffsetDateTime deletedAt;

    public Application(User user, String companyName, String jobTitle) {
        this.user = user;
        this.companyName = companyName;
        this.jobTitle = jobTitle;
    }

    /** 문항을 적은 순서대로 붙인다. 순서(itemOrder)는 1부터 매긴다. */
    public void addCoverLetterItem(String question, String answer) {
        coverLetterItems.add(
                new CoverLetterItem(this, coverLetterItems.size() + 1, question, answer));
    }

    public List<CoverLetterItem> getCoverLetterItems() {
        return Collections.unmodifiableList(coverLetterItems);
    }

    public void delete(OffsetDateTime now) {
        this.deletedAt = now;
    }
}
