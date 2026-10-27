package com.ssafy.a301.admin.service;

import com.ssafy.a301.admin.domain.Admin;
import com.ssafy.a301.admin.domain.GrantStatus;
import com.ssafy.a301.admin.domain.GrantTarget;
import com.ssafy.a301.admin.domain.Notice;
import com.ssafy.a301.admin.domain.StreakFreezeGrant;
import com.ssafy.a301.admin.domain.StreakFreezeGrantTarget;
import com.ssafy.a301.admin.domain.StreakFreezeStatus;
import com.ssafy.a301.admin.dto.AdminDtos.AdminUserItem;
import com.ssafy.a301.admin.dto.AdminDtos.StreakFreezeGrantRequest;
import com.ssafy.a301.admin.dto.AdminDtos.StreakFreezeGrantResponse;
import com.ssafy.a301.admin.mapper.AdminMapper;
import com.ssafy.a301.admin.repository.AdminRepository;
import com.ssafy.a301.admin.repository.AdminUserRepository;
import com.ssafy.a301.admin.repository.NoticeRepository;
import com.ssafy.a301.admin.repository.StreakFreezeGrantRepository;
import com.ssafy.a301.admin.repository.StreakFreezeGrantTargetRepository;
import com.ssafy.a301.admin.repository.StreakFreezeRepository;
import com.ssafy.a301.admin.repository.StreakFreezeRepository.GrantCount;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.user.domain.User;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PagedModel;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 8.10 ~ 8.12 스트릭 유지권 배포. 등록은 SCHEDULED로 남기고, 지급 날짜(한국 시간)가 되면 그때의 대상 회원마다 유지권을 개수만큼 만든다. 지급 날짜가
 * 오늘이거나 지났으면 등록하면서 바로 지급한다. 유효기간은 지급 날짜 0시부터 2주다. 전체 회원 배포는 지급할 때 공지를 함께 만든다. 배포는 취소하지 않는다.
 */
@Service
public class StreakFreezeGrantService {
    private static final Logger LOG = LoggerFactory.getLogger(StreakFreezeGrantService.class);
    private static final int VALID_DAYS = 14;
    private static final String NOTICE_TITLE = "스트릭 유지권을 드렸어요";
    private static final String NOTICE_CONTENT =
            "%d월 %d일을 메울 수 있는 유지권 %d개를 드렸어요. 마이페이지에서 %d월 %d일까지 쓸 수 있어요.";
    // 최근 등록 순. 같은 시각이면 id로 순서를 고정한다
    private static final Sort RECENT_FIRST =
            Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"));

    private final StreakFreezeGrantRepository grants;
    private final StreakFreezeGrantTargetRepository targets;
    private final StreakFreezeRepository freezes;
    private final NoticeRepository notices;
    private final AdminRepository admins;
    private final AdminUserRepository users;
    private final TransactionTemplate transactions;
    private final TransactionTemplate newTransaction;

    public StreakFreezeGrantService(
            StreakFreezeGrantRepository grants,
            StreakFreezeGrantTargetRepository targets,
            StreakFreezeRepository freezes,
            NoticeRepository notices,
            AdminRepository admins,
            AdminUserRepository users,
            TransactionTemplate transactions,
            PlatformTransactionManager transactionManager) {
        this.grants = grants;
        this.targets = targets;
        this.freezes = freezes;
        this.notices = notices;
        this.admins = admins;
        this.users = users;
        this.transactions = transactions;
        this.newTransaction = new TransactionTemplate(transactionManager);
        newTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public PagedModel<StreakFreezeGrantResponse> list(int page, int size) {
        Page<StreakFreezeGrant> found = grants.findPage(PageRequest.of(page, size, RECENT_FIRST));
        Map<Long, Integer> counts = targetCounts(found.getContent());
        return new PagedModel<>(
                found.map(g -> AdminMapper.toGrant(g, counts.getOrDefault(g.getId(), 0))));
    }

    /** 지정 회원이 없거나 탈퇴했으면 404 USER_NOT_FOUND */
    public StreakFreezeGrantResponse grant(long adminId, StreakFreezeGrantRequest request) {
        List<Long> userIds =
                request.userIds() == null
                        ? List.of()
                        : request.userIds().stream().distinct().toList();
        if (request.targetType() == GrantTarget.USERS && userIds.isEmpty()) {
            throw new FieldValidationException("userIds", "배포 대상이 USERS면 1명 이상입니다.");
        }
        if (request.targetType() == GrantTarget.ALL && !userIds.isEmpty()) {
            throw new FieldValidationException("userIds", "배포 대상이 ALL이면 보내지 않습니다.");
        }
        String reason =
                request.reason() == null || request.reason().isBlank()
                        ? null
                        : request.reason().strip();
        StreakFreezeGrant saved =
                transactions.execute(
                        status -> {
                            List<User> targetUsers =
                                    userIds.isEmpty() ? List.of() : users.findActiveByIds(userIds);
                            if (targetUsers.size() != userIds.size()) {
                                throw new ApiException(ErrorCode.USER_NOT_FOUND);
                            }
                            // 응답에 관리자 이름을 쓰므로 프록시가 아닌 엔티티로 읽는다
                            Admin admin =
                                    admins.findByIdAndDeletedAtIsNull(adminId)
                                            .orElseThrow(
                                                    () -> new ApiException(ErrorCode.UNAUTHORIZED));
                            StreakFreezeGrant grant =
                                    grants.saveAndFlush(
                                            new StreakFreezeGrant(
                                                    admin,
                                                    request.targetType(),
                                                    request.quantity(),
                                                    request.grantDate(),
                                                    request.fillableDate(),
                                                    reason));
                            targets.saveAllAndFlush(
                                    targetUsers.stream()
                                            .map(u -> new StreakFreezeGrantTarget(grant, u))
                                            .toList());
                            if (grant.isDue(KoreaTime.today())) {
                                execute(grant, KoreaTime.now());
                            }
                            return grant;
                        });
        return AdminMapper.toGrant(
                saved, targetCounts(List.of(saved)).getOrDefault(saved.getId(), 0));
    }

    /** 이메일·닉네임에 검색어가 들어간 탈퇴하지 않은 회원. 최근 가입 순 */
    public PagedModel<AdminUserItem> searchUsers(String keyword, int page, int size) {
        String pattern =
                "%"
                        + keyword.strip()
                                .toLowerCase()
                                .replace("\\", "\\\\")
                                .replace("%", "\\%")
                                .replace("_", "\\_")
                        + "%";
        return new PagedModel<>(
                users.search(pattern, PageRequest.of(page, size, RECENT_FIRST))
                        .map(AdminMapper::toUserItem));
    }

    /** 지급 날짜가 된 배포를 지급한다(매일 0시, 기동할 때). 배포마다 따로 커밋해 하나가 실패해도 나머지는 지급한다. 지급한 배포 수를 준다. */
    public int grantDue() {
        int granted = 0;
        for (long id : grants.findDueIds(GrantStatus.SCHEDULED, KoreaTime.today())) {
            try {
                Boolean done =
                        newTransaction.execute(
                                status ->
                                        grants.findForUpdate(id)
                                                .filter(g -> g.isDue(KoreaTime.today()))
                                                .map(
                                                        g -> {
                                                            execute(g, KoreaTime.now());
                                                            return true;
                                                        })
                                                .orElse(false));
                if (Boolean.TRUE.equals(done)) {
                    granted++;
                }
            } catch (RuntimeException ex) {
                LOG.error("유지권 배포를 지급하지 못했다: {}", id, ex);
            }
        }
        return granted;
    }

    /** 기간이 지난 사용 가능 유지권을 EXPIRED로 바꾼다(매일 0시, 기동할 때). 조회·사용은 이 작업과 상관없이 만료 시각으로 판단한다 */
    public int expireFreezes() {
        Integer expired =
                newTransaction.execute(
                        status ->
                                freezes.expire(
                                        StreakFreezeStatus.AVAILABLE,
                                        StreakFreezeStatus.EXPIRED,
                                        KoreaTime.now()));
        return expired == null ? 0 : expired;
    }

    // 트랜잭션 안에서 부른다. 배포 행은 이미 저장(flush)돼 있어야 한다
    private void execute(StreakFreezeGrant grant, OffsetDateTime now) {
        OffsetDateTime start = KoreaTime.startOfDay(grant.getGrantDate());
        OffsetDateTime expiresAt = start.plusDays(VALID_DAYS);
        int created =
                freezes.insertForGrant(
                        grant.getId(),
                        StreakFreezeStatus.AVAILABLE.name(),
                        GrantTarget.ALL.name(),
                        now,
                        expiresAt);
        grant.markGranted(now);
        if (grant.getTargetType() == GrantTarget.ALL) {
            notices.save(
                    new Notice(
                            grant.getAdmin(),
                            NOTICE_TITLE,
                            noticeContent(grant, expiresAt),
                            start,
                            expiresAt));
        }
        LOG.info("유지권 배포를 지급했다: {} (유지권 {}개)", grant.getId(), created);
    }

    private static String noticeContent(StreakFreezeGrant grant, OffsetDateTime expiresAt) {
        LocalDate fillable = grant.getFillableDate();
        LocalDate until = KoreaTime.dateOf(expiresAt);
        return NOTICE_CONTENT.formatted(
                fillable.getMonthValue(),
                fillable.getDayOfMonth(),
                grant.getQuantity(),
                until.getMonthValue(),
                until.getDayOfMonth());
    }

    // 지급함은 실제로 받은 회원 수, 지급 전은 지정 회원 수 또는 지금의 탈퇴하지 않은 회원 수
    private Map<Long, Integer> targetCounts(List<StreakFreezeGrant> page) {
        Map<Long, Integer> counts = new HashMap<>();
        List<Long> granted = idsOf(page, g -> g.getStatus() == GrantStatus.GRANTED);
        List<Long> scheduledUsers =
                idsOf(
                        page,
                        g ->
                                g.getStatus() == GrantStatus.SCHEDULED
                                        && g.getTargetType() == GrantTarget.USERS);
        List<Long> scheduledAll =
                idsOf(
                        page,
                        g ->
                                g.getStatus() == GrantStatus.SCHEDULED
                                        && g.getTargetType() == GrantTarget.ALL);
        if (!granted.isEmpty()) {
            put(counts, freezes.countUsersByGrantIds(granted));
        }
        if (!scheduledUsers.isEmpty()) {
            put(counts, targets.countByGrantIds(scheduledUsers));
        }
        if (!scheduledAll.isEmpty()) {
            int active = (int) users.countActive();
            scheduledAll.forEach(id -> counts.put(id, active));
        }
        return counts;
    }

    private static List<Long> idsOf(
            List<StreakFreezeGrant> page, Predicate<StreakFreezeGrant> filter) {
        return page.stream().filter(filter).map(StreakFreezeGrant::getId).toList();
    }

    private static void put(Map<Long, Integer> counts, List<GrantCount> rows) {
        rows.forEach(r -> counts.put(r.getGrantId(), (int) r.getCount()));
    }
}
