package com.ssafy.a301.admin.service;

import com.ssafy.a301.admin.domain.StreakFreeze;
import com.ssafy.a301.admin.domain.StreakFreezeStatus;
import com.ssafy.a301.admin.dto.AdminDtos.MyStreakFreezesResponse;
import com.ssafy.a301.admin.dto.AdminDtos.StreakFreezeUseResponse;
import com.ssafy.a301.admin.mapper.AdminMapper;
import com.ssafy.a301.admin.repository.StreakFreezeRepository;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.practice.service.PracticeService;
import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 8.13 · 8.14 내 스트릭 유지권. 유지권을 쓰면 그 유지권의 메울 수 있는 날짜를 연습 기록(practice_logs)에 넣어 스트릭·연습 달력에 연습한 날로 들어가게
 * 한다. 연습 기록·스트릭은 PracticeService로 넣고 계산한다(5.8 면접 끝내기와 같음).
 */
@Service
public class StreakFreezeService {

    private final StreakFreezeRepository freezes;
    private final PracticeService practices;
    private final TransactionTemplate transactions;

    public StreakFreezeService(
            StreakFreezeRepository freezes,
            PracticeService practices,
            TransactionTemplate transactions) {
        this.freezes = freezes;
        this.practices = practices;
        this.transactions = transactions;
    }

    /** 지금 쓸 수 있는 유지권(사용 전, 만료 전). 만료가 빠른 순 */
    public MyStreakFreezesResponse mine(long userId) {
        List<StreakFreeze> usable =
                freezes.findUsable(userId, StreakFreezeStatus.AVAILABLE, KoreaTime.now());
        return new MyStreakFreezesResponse(
                usable.size(), usable.stream().map(AdminMapper::toFreezeItem).toList());
    }

    /**
     * 유지권 행을 잠그고 사용함으로 바꾼 뒤 메울 날짜의 연습 기록을 넣는다. 없거나 남의 유지권 404, 이미 썼거나 만료 409, 그날 이미 연습 기록이 있으면
     * 409이며 유지권은 그대로 남는다.
     */
    public StreakFreezeUseResponse use(long userId, long freezeId) {
        return transactions.execute(
                status -> {
                    OffsetDateTime now = KoreaTime.now();
                    StreakFreeze freeze =
                            freezes.findForUpdate(freezeId, userId)
                                    .orElseThrow(
                                            () ->
                                                    new ApiException(
                                                            ErrorCode.STREAK_FREEZE_NOT_FOUND));
                    freeze.use(now);
                    if (!practices.record(userId, freeze.getFillableDate())) {
                        throw new ApiException(ErrorCode.STREAK_FREEZE_DATE_NOT_ALLOWED);
                    }
                    int available =
                            (int) freezes.countUsable(userId, StreakFreezeStatus.AVAILABLE, now);
                    int currentStreak = practices.currentStreak(userId);
                    return AdminMapper.toFreezeUse(freeze, available, currentStreak);
                });
    }
}
