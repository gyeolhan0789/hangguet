package com.ssafy.a301.application.service;

import static com.ssafy.a301.TestEntities.withId;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationCreateRequest;
import com.ssafy.a301.application.dto.ApplicationDtos.CoverLetterItem;
import com.ssafy.a301.application.dto.ApplicationDtos.CoverLetterItemRequest;
import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.application.repository.CoverLetterCheckQueue;
import com.ssafy.a301.application.repository.CoverLetterCheckQueue.Item;
import com.ssafy.a301.application.repository.CoverLetterCheckQueue.Verdict;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.interview.domain.AiJobType;
import com.ssafy.a301.interview.service.AiJobService;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

// 기준: API 명세 4.1 · 4.2 · 4.3 · 4.5(문항 단위 자기소개서, 수정 없음, 지워도 행은 남김) · AI 명세 2.1 자기소개서 검증
// · AI 명세 2장 STEP 01(지원서를 저장하며 주장 추출을 요청하고, 저장 응답은 추출을 기다리지 않는다)
class ApplicationServiceTest {
    private static final long USER_ID = 7L;
    private static final List<CoverLetterItemRequest> ITEMS =
            List.of(
                    new CoverLetterItemRequest("지원 동기", "저는…"),
                    new CoverLetterItemRequest("협업 경험", "함께했습니다."));
    // 검증에는 요청 문항을 같은 순서의 질문 · 답변으로 바꿔 넘긴다
    private static final List<Item> CHECK_ITEMS =
            List.of(new Item("지원 동기", "저는…"), new Item("협업 경험", "함께했습니다."));

    private final ApplicationRepository applications = mock(ApplicationRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final CoverLetterCheckQueue coverLetterChecks = mock(CoverLetterCheckQueue.class);
    private final AiJobService aiJobs = mock(AiJobService.class);
    // 실제 TransactionTemplate으로 콜백을 실행하고, 커밋·롤백은 가짜 매니저로 확인한다
    private final PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);
    private final User user = withId(new User("a@test.com", "hash", "회원"), USER_ID);
    private ApplicationService service;
    private Application application;

    @BeforeEach
    void setUp() {
        service =
                new ApplicationService(
                        applications,
                        users,
                        new TransactionTemplate(txManager),
                        coverLetterChecks,
                        aiJobs);
        when(coverLetterChecks.check(any(), any(), any())).thenReturn(Verdict.USABLE);
        application = withId(new Application(user, "○○전자", "백엔드 개발자"), 10);
        application.addCoverLetterItem("지원 동기", "저는…");
        application.addCoverLetterItem("협업 경험", "함께했습니다.");
        when(applications.findByIdAndUserIdAndDeletedAtIsNull(10L, USER_ID))
                .thenReturn(Optional.of(application));
        when(applications.findForUpdate(10L, USER_ID)).thenReturn(Optional.of(application));
    }

    @Test
    void createSavesItemsInOrderAfterCheck() {
        when(users.getReferenceById(USER_ID)).thenReturn(user);
        when(applications.saveAndFlush(any())).thenAnswer(inv -> withId(inv.getArgument(0), 11));

        var response =
                service.create(USER_ID, new ApplicationCreateRequest("△△소프트", "서버 개발자", ITEMS));

        assertThat(response.id()).isEqualTo(11);
        assertThat(response.companyName()).isEqualTo("△△소프트");
        assertThat(response.coverLetterItems())
                .containsExactly(
                        new CoverLetterItem(1, "지원 동기", "저는…"),
                        new CoverLetterItem(2, "협업 경험", "함께했습니다."));
        // AI 검증은 트랜잭션을 열기 전에 끝낸다(검증을 기다리는 동안 DB 연결을 잡지 않음).
        // 주장 추출은 저장과 같은 트랜잭션에서 Outbox에 넣는다(커밋되어야 큐로 간다)
        InOrder order = inOrder(coverLetterChecks, txManager, aiJobs);
        order.verify(coverLetterChecks).check("△△소프트", "서버 개발자", CHECK_ITEMS);
        order.verify(txManager).getTransaction(any());
        order.verify(aiJobs)
                .enqueue(
                        argThat(
                                job ->
                                        job.getJobType() == AiJobType.EXTRACT_CLAIMS
                                                && Long.valueOf(11).equals(job.getApplicationId())
                                                && job.getSessionId() == null));
        order.verify(txManager).commit(any());
    }

    @Test
    void getReturnsItemsInOrder() {
        var response = service.get(USER_ID, 10L);

        assertThat(response.coverLetterItems())
                .extracting(CoverLetterItem::itemOrder, CoverLetterItem::question)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(1, "지원 동기"),
                        org.assertj.core.groups.Tuple.tuple(2, "협업 경험"));
    }

    // 없는 지원서 · 남의 지원서 · 지운 지원서는 저장소에서 같은 조회 결과(빈 값)라 모두 404다
    @Test
    void applicationNotFoundByRepositoryIsNotFound() {
        assertCode(() -> service.get(USER_ID, 99L), ErrorCode.APPLICATION_NOT_FOUND);
        assertCode(() -> service.delete(USER_ID, 99L), ErrorCode.APPLICATION_NOT_FOUND);
    }

    // 지운 지원서를 빼는 조건은 저장소 메서드(DeletedAtIsNull)에 있다. 여기서는 그 메서드에 최근 작성 순 페이지를 넘기는지 본다
    @Test
    void listQueriesUndeletedApplicationsRecentFirst() {
        var older = withId(new Application(user, "△△소프트", "서버 개발자"), 9);
        when(applications.findByUserIdAndDeletedAtIsNull(eq(USER_ID), any(Pageable.class)))
                .thenAnswer(
                        inv -> new PageImpl<>(List.of(application, older), inv.getArgument(1), 2));

        var page = service.list(USER_ID, 0, 10);

        assertThat(page.getContent()).extracting("id").containsExactly(10L, 9L);
        assertThat(page.getMetadata().totalElements()).isEqualTo(2);
        verify(applications)
                .findByUserIdAndDeletedAtIsNull(
                        USER_ID,
                        PageRequest.of(
                                0,
                                10,
                                Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))));
    }

    // 4.3: JPA가 다루지 못하는 offset의 페이지도 빈 목록과 전체 건수를 준다. 건수는 첫 페이지(1건) 조회의 전체 건수로 센다(4.6과 같음)
    @Test
    void listPageBeyondJpaOffsetLimitReturnsEmptyPageWithTotal() {
        PageRequest firstOne = PageRequest.of(0, 1);
        when(applications.findByUserIdAndDeletedAtIsNull(USER_ID, firstOne))
                .thenReturn(new PageImpl<>(List.of(application), firstOne, 5));

        var page = service.list(USER_ID, Integer.MAX_VALUE, 20);

        assertThat(page.getContent()).isEmpty();
        assertThat(page.getMetadata().number()).isEqualTo(Integer.MAX_VALUE);
        assertThat(page.getMetadata().size()).isEqualTo(20);
        assertThat(page.getMetadata().totalElements()).isEqualTo(5);
        verify(applications).findByUserIdAndDeletedAtIsNull(USER_ID, firstOne);
        verifyNoMoreInteractions(applications);
    }

    // 기준: AI 명세 2.1 자기소개서 검증(질문을 만들 수 없는 글은 400 coverLetterItems, 판단하지 못하면 503)
    @Test
    void unusableCoverLetterIsNotSaved() {
        when(coverLetterChecks.check("△△소프트", "서버 개발자", CHECK_ITEMS)).thenReturn(Verdict.UNUSABLE);

        assertThatThrownBy(
                        () ->
                                service.create(
                                        USER_ID,
                                        new ApplicationCreateRequest("△△소프트", "서버 개발자", ITEMS)))
                .isInstanceOfSatisfying(
                        FieldValidationException.class,
                        ex -> {
                            assertThat(ex.field()).isEqualTo("coverLetterItems");
                            assertThat(ex.reason())
                                    .isEqualTo(ApplicationService.UNUSABLE_COVER_LETTER);
                        });
        verify(applications, never()).saveAndFlush(any());
        verify(aiJobs, never()).enqueue(any());
    }

    @Test
    void coverLetterCheckFailureIsUnavailable() {
        when(coverLetterChecks.check(any(), any(), any())).thenReturn(Verdict.UNAVAILABLE);

        assertCode(
                () ->
                        service.create(
                                USER_ID, new ApplicationCreateRequest("△△소프트", "서버 개발자", ITEMS)),
                ErrorCode.COVER_LETTER_CHECK_UNAVAILABLE);
        verify(applications, never()).saveAndFlush(any());
    }

    @Test
    void deleteOnlyMarksDeletedAtAndKeepsRow() {
        OffsetDateTime before = OffsetDateTime.now();

        service.delete(USER_ID, 10L);

        assertThat(application.getDeletedAt()).isNotNull().isAfterOrEqualTo(before);
        // 면접 만들기(5.1)와 같은 행 잠금(findForUpdate)으로 찾는다
        verify(applications).findForUpdate(10L, USER_ID);
        verify(applications, never()).findByIdAndUserIdAndDeletedAtIsNull(anyLong(), anyLong());
        verify(applications, never()).delete(any());
        verify(txManager).commit(any());
    }

    private static void assertCode(Runnable operation, ErrorCode expected) {
        assertThatThrownBy(operation::run)
                .isInstanceOfSatisfying(
                        ApiException.class, ex -> assertThat(ex.errorCode()).isEqualTo(expected));
    }
}
