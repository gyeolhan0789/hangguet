package com.ssafy.a301.application.domain;

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
import java.time.OffsetDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

/** 지원서. 면접에 쓴 지원서는 수정·삭제하지 않는다(서비스에서 확인 → 409 APPLICATION_IN_USE). */
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

    @Column(name = "cover_letter", nullable = false, columnDefinition = "TEXT")
    private String coverLetter;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public Application(User user, String companyName, String jobTitle, String coverLetter) {
        this.user = user;
        this.companyName = companyName;
        this.jobTitle = jobTitle;
        this.coverLetter = coverLetter;
    }

    // 4.4: 보낸 필드만 바꾼다(null은 그대로)
    public void update(String companyName, String jobTitle, String coverLetter) {
        if (companyName != null) {
            this.companyName = companyName;
        }
        if (jobTitle != null) {
            this.jobTitle = jobTitle;
        }
        if (coverLetter != null) {
            this.coverLetter = coverLetter;
        }
    }
}
