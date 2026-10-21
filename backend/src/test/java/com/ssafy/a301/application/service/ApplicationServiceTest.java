package com.ssafy.a301.application.service;

import static com.ssafy.a301.TestEntities.withId;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationCreateRequest;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationUpdateRequest;
import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

class ApplicationServiceTest {
    private static final long USER_ID = 7L;

    private final ApplicationRepository applications = mock(ApplicationRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    // 실제 TransactionTemplate으로 콜백을 실행하고, 커밋·롤백은 가짜 매니저로 확인한다
    private final PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);
    private final User user = withId(new User("a@test.com", "hash", "회원"), USER_ID);
    private ApplicationService service;
    private Application application;

    @BeforeEach
    void setUp() {
        service = new ApplicationService(applications, users, new TransactionTemplate(txManager));
        application = withId(new Application(user, "○○전자", "백엔드 개발자", "저는…"), 10);
        when(applications.findByIdAndUserId(10L, USER_ID)).thenReturn(Optional.of(application));
        when(applications.findForUpdate(10L, USER_ID)).thenReturn(Optional.of(application));
    }

    @Test
    void createdApplicationIsNotInUse() {
        when(users.getReferenceById(USER_ID)).thenReturn(user);
        when(applications.save(any())).thenAnswer(inv -> withId(inv.getArgument(0), 11));

        var response =
                service.create(USER_ID, new ApplicationCreateRequest("△△소프트", "서버 개발자", "지원 동기"));

        assertThat(response.id()).isEqualTo(11);
        assertThat(response.companyName()).isEqualTo("△△소프트");
        assertThat(response.inUse()).isFalse();
    }

    @Test
    void getShowsWhetherApplicationIsInUse() {
        when(applications.isInUse(10L)).thenReturn(true);

        var response = service.get(USER_ID, 10L);

        assertThat(response.coverLetter()).isEqualTo("저는…");
        assertThat(response.inUse()).isTrue();
    }

    @Test
    void missingOrOthersApplicationIsNotFound() {
        assertCode(() -> service.get(USER_ID, 99L), ErrorCode.APPLICATION_NOT_FOUND);
        assertCode(
                () -> service.update(USER_ID, 99L, new ApplicationUpdateRequest("x", null, null)),
                ErrorCode.APPLICATION_NOT_FOUND);
        assertCode(() -> service.delete(USER_ID, 99L), ErrorCode.APPLICATION_NOT_FOUND);
    }

    @Test
    void listIsRecentFirstAndChecksInUseOnce() {
        var older = withId(new Application(user, "△△소프트", "서버 개발자", "…"), 9);
        when(applications.findByUserId(eq(USER_ID), any(Pageable.class)))
                .thenAnswer(
                        inv -> new PageImpl<>(List.of(application, older), inv.getArgument(1), 2));
        when(applications.findIdsInUse(List.of(10L, 9L))).thenReturn(List.of(9L));

        var page = service.list(USER_ID, 0, 10);

        assertThat(page.getContent()).extracting("id").containsExactly(10L, 9L);
        assertThat(page.getContent()).extracting("inUse").containsExactly(false, true);
        assertThat(page.getMetadata().totalElements()).isEqualTo(2);
        verify(applications, times(1)).findIdsInUse(anyCollection());
        verify(applications)
                .findByUserId(
                        USER_ID,
                        PageRequest.of(
                                0,
                                10,
                                Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))));
    }

    @Test
    void emptyListSkipsInUseQuery() {
        when(applications.findByUserId(eq(USER_ID), any(Pageable.class)))
                .thenReturn(Page.empty(PageRequest.of(0, 10)));

        assertThat(service.list(USER_ID, 0, 10).getContent()).isEmpty();
        verify(applications, never()).findIdsInUse(anyCollection());
    }

    @Test
    void updateChangesOnlySentFields() {
        var response =
                service.update(USER_ID, 10L, new ApplicationUpdateRequest(null, "서버 개발자", null));

        assertThat(response.companyName()).isEqualTo("○○전자");
        assertThat(response.jobTitle()).isEqualTo("서버 개발자");
        assertThat(response.coverLetter()).isEqualTo("저는…");
        verify(txManager).commit(any());
    }

    @Test
    void applicationInUseCannotBeUpdatedOrDeleted() {
        when(applications.isInUse(10L)).thenReturn(true);

        assertCode(
                () -> service.update(USER_ID, 10L, new ApplicationUpdateRequest("x", null, null)),
                ErrorCode.APPLICATION_IN_USE);
        assertCode(() -> service.delete(USER_ID, 10L), ErrorCode.APPLICATION_IN_USE);
        assertThat(application.getCompanyName()).isEqualTo("○○전자");
        verify(applications, never()).delete(any());
        verify(txManager, never()).commit(any());
    }

    @Test
    void deleteRemovesApplication() {
        service.delete(USER_ID, 10L);

        verify(applications).delete(application);
        verify(txManager).commit(any());
    }

    @Test
    void interviewCreatedDuringDeleteIsInUse() {
        doThrow(new DataIntegrityViolationException("fk_interview_sessions_application"))
                .when(applications)
                .flush();

        assertCode(() -> service.delete(USER_ID, 10L), ErrorCode.APPLICATION_IN_USE);
    }

    private static void assertCode(Runnable operation, ErrorCode expected) {
        assertThatThrownBy(operation::run)
                .isInstanceOfSatisfying(
                        ApiException.class, ex -> assertThat(ex.errorCode()).isEqualTo(expected));
    }
}
