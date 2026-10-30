"use client";

import {
  motion,
  MotionConfig,
  useAnimate,
  useInView,
  useReducedMotion,
  type Variants,
} from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type RefObject } from "react";

import { InquiryButton, InquiryModal } from "@/components/inquiry/inquiry-ui";
import { MaskIcon } from "@/components/mask-icon";
import { Spinner } from "@/components/spinner";
import { deleteApplication } from "@/lib/application/actions";
import { applicationDate, applicationSessionTitle } from "@/lib/application/format";
import { pendingLabel } from "@/lib/records/format";
import { applicationPath, interviewerPath, replayPath, resultPath, ROUTES } from "@/lib/routes";
import type {
  ApplicationResponse,
  ApplicationSessionListResponse,
  SessionListItem,
} from "@/types/api";

import { ApplicationPager } from "../../_components/application-pager";

// 기준: Figma 지원 관리 · 상세 · 상세 · 면접에 씀 · 삭제 확인(화이트 · 다크: S07 피드백 결과 틀 — 본문 위 36 · 가운데 880 · 간격 24,
// '‹ 지원 관리' 15 SemiBold text-3 · 제목 28/36 ExtraBold · 작성일 15 SemiBold text-3 · 오른쪽 아래 '삭제' 14 SemiBold text-3
// / '자기소개서' · '면접 기록' 20 ExtraBold(간격 12) / 상자 bg-sub · 테두리 line · 둥글기 20 · 좌우 24 · 위아래 4, 줄 사이 1px 구분선
// / 문항 줄 위아래 14 · 간격 6: 'Q1' 15 ExtraBold brand-ink + 문항 17 Bold(간격 12), 답변 15 Medium text-2 왼쪽 38
// / 아래 막대 높이 96 · 위 테두리 line · [이 지원서로 면접 보기] 높이 60 · 둥글기 16 · brand-strong · 18 Bold · arrow-right 20
// / 면접 기록: 제목 옆 'N회' 15 SemiBold text-3(간격 8), 같은 상자에 줄 위아래 14 · 줄 사이 1px line, '10.21 · 개발자 커피챗 · 채팅'
//   16 SemiBold text-1 · 한 줄 총평 13 Medium text-3(간격 2), 오른쪽 '상세 피드백 ›' · '다시보기 ›' 14 SemiBold text-3(간격 16)
//   · 분석 중은 '분석 중' 14 SemiBold text-3만, 없으면 상자 위아래 28 가운데 '아직 이 지원서로 본 면접이 없어요' 15 SemiBold text-3
// / 삭제 확인: I03-1 모달 '지원서를 삭제할까요?' · '삭제하면 되돌릴 수 없어요' · [취소] · [삭제])
// · Swagger 4.2 ApplicationResponse(companyName · jobTitle · coverLetterItems · createdAt) · 4.5 지원서 삭제 · 5.1 applicationId
// · 4.6 지원서의 연습 면접 목록(시작 시각 내림차순 · totalElements · COMPLETED만 결과 · 다시보기)
// · 기획 메모 지원 관리(수정 기능 없음, 삭제는 면접에 쓴 지원서도 가능, 면접 기록 줄은 연습 기록과 같은 모양 — 분석 중 · 실패는 상태만)
// · 모션 메모 지원 관리 · 상세(진입: 제목 → 자기소개서 → 면접 기록 y 12→0 · opacity stagger 0.06s, 문항은 모두 펼침,
//   면접 기록 줄 hover: 배경 살짝 진해지고 ›가 x 0→3, 하단 버튼은 스크롤해도 고정 · 페이지 끝에 닿으면 한 번 통통)
// · 모션 메모 지원 관리 · 상세 · 면접에 씀('분석 중'은 글자 옆 스피너만 회전) · 모션 메모 삭제 확인(dim 페이드 + 모달 팝,
//   기다리는 동안 두 번 못 누름)
// · 사용자 결정(2026-10-29: [이 지원서로 면접 보기] → S04, 실패는 연습 기록처럼 '분석 실패', 면접 기록이 한 쪽(10개)을 넘으면
//   지원 관리 목록과 같은 '‹ 1 / N ›'로 넘긴다)

const rise: Variants = {
  hidden: { y: 12, opacity: 0 },
  shown: { y: 0, opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
};

type DetailProps = {
  application: ApplicationResponse;
  sessions: ApplicationSessionListResponse;
};

/**
 * 지원서 상세. 한 번 본 화면은 상태를 살려 다시 보여 주므로(cacheComponents · Activity), 새로 들어올 때마다(push · replace)
 * 상세를 새로 그려 진입 등장(제목 → 자기소개서 → 면접 기록)과 페이지 끝 통통을 다시 보여 준다. 뒤로 · 앞으로 가기로
 * 돌아오면 그대로 둔다(Next useRouter().bfcacheId — 지원서 쓰기와 같은 방식).
 */
export function ApplicationDetail(props: DetailProps) {
  const { bfcacheId } = useRouter();
  return <Detail key={bfcacheId} {...props} />;
}

function Detail({ application, sessions }: DetailProps) {
  const reduce = useReducedMotion();
  const end = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [deleting, startDeleting] = useTransition();
  const deleteButton = useRef<HTMLButtonElement>(null);

  /** 삭제 확인을 닫고, 모달을 연 [삭제]로 포커스를 돌려준다 */
  const closeConfirm = () => {
    setConfirming(false);
    deleteButton.current?.focus();
  };

  // 뒤로 · 앞으로 가기로 돌아오면 bfcacheId가 같아 새로 그리지 않고 상태를 그대로 보여 주므로(Activity),
  // 떠날 때 삭제 확인 모달과 지난 문구를 닫는다. 새로 들어올 때(push · replace)는 위의 key로 처음부터 그린다.
  useLayoutEffect(
    () => () => {
      setConfirming(false);
      setDeleteError(undefined);
    },
    [],
  );

  // 삭제 확인: [취소] · Esc → 닫기. 삭제 요청 중에는 닫지 않는다(I03-1과 같음)
  useEffect(() => {
    if (!confirming || deleting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeConfirm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming, deleting]);

  const remove = () => {
    setDeleteError(undefined);
    // 성공 · 이미 없는 지원서(404)는 서버 액션이 목록으로 보낸다.
    startDeleting(async () => {
      const result = await deleteApplication(application.id);
      if (result.error) setDeleteError(result.error);
    });
  };

  // 동작 줄이기면 등장 · 모달 팝 같은 위치 · 크기 연출을 끄고 투명도만 바꾼다(모션 메모 지원 관리 · 상세 · 삭제 확인).
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        className="mx-auto flex w-full max-w-[912px] flex-1 flex-col gap-6 px-4 pt-9 pb-10"
        initial={reduce ? false : "hidden"}
        animate="shown"
        transition={{ staggerChildren: 0.06 }}
      >
        <motion.section variants={rise} className="flex w-full items-end justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1">
            <Link
              href={ROUTES.applications}
              className="flex w-fit items-center gap-1 rounded-md text-[15px] leading-normal font-semibold tracking-[-0.2px] text-text-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <MaskIcon src="/mypage/icon-chevron-left.svg" size={18} className="bg-text-3" />
              지원 관리
            </Link>
            <h1 className="text-[28px] leading-[1.3] font-extrabold tracking-[-1px] break-words break-keep text-text-1 md:text-[36px]">
              {application.companyName} · {application.jobTitle}
            </h1>
            <p className="text-[15px] leading-normal font-semibold tracking-[-0.2px] text-text-3">
              {applicationDate(application.createdAt)} 작성
            </p>
          </div>
          <button
            ref={deleteButton}
            type="button"
            onClick={() => {
              setDeleteError(undefined);
              setConfirming(true);
            }}
            className="shrink-0 cursor-pointer rounded-md text-sm leading-normal font-semibold tracking-[-0.2px] text-text-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            삭제
          </button>
        </motion.section>

        <motion.section
          variants={rise}
          aria-labelledby="cover-letter"
          className="flex w-full flex-col gap-3"
        >
          <h2
            id="cover-letter"
            className="text-xl leading-normal font-extrabold tracking-[-0.2px] text-text-1"
          >
            자기소개서
          </h2>
          <ol className="flex w-full flex-col rounded-[20px] border border-line bg-bg-sub px-6 py-1">
            {application.coverLetterItems.map((item, i) => (
              <li
                key={item.itemOrder}
                className={`flex flex-col gap-1.5 py-3.5 leading-normal tracking-[-0.2px] ${i > 0 ? "border-t border-line" : ""}`}
              >
                <p className="flex items-baseline gap-3">
                  <span className="shrink-0 text-[15px] leading-normal font-extrabold text-brand-ink">
                    Q{item.itemOrder}
                  </span>
                  <span className="min-w-0 text-[17px] font-bold break-words break-keep text-text-1">
                    {item.question}
                  </span>
                </p>
                <p className="pl-[38px] text-[15px] font-medium break-words whitespace-pre-wrap text-text-2">
                  {item.answer}
                </p>
              </li>
            ))}
          </ol>
        </motion.section>

        <motion.section
          variants={rise}
          aria-labelledby="interview-records"
          className="flex w-full flex-col gap-3"
        >
          <div className="flex items-center gap-2">
            <h2
              id="interview-records"
              className="text-xl leading-normal font-extrabold tracking-[-0.2px] text-text-1"
            >
              면접 기록
            </h2>
            <span className="text-[15px] leading-normal font-semibold tracking-[-0.2px] text-text-3">
              {sessions.page.totalElements}회
            </span>
          </div>
          {sessions.content.length > 0 ? (
            <ul className="flex w-full flex-col overflow-hidden rounded-[20px] border border-line bg-bg-sub px-6 py-1">
              {sessions.content.map((item) => (
                <li key={item.id} className="border-b border-line last:border-b-0">
                  <SessionRow item={item} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="w-full rounded-[20px] border border-line bg-bg-sub px-6 py-7 text-center text-[15px] leading-normal font-semibold tracking-[-0.2px] text-text-3">
              아직 이 지원서로 본 면접이 없어요
            </p>
          )}
          {sessions.page.totalPages > 1 && (
            <ApplicationPager
              page={sessions.page.number}
              totalPages={sessions.page.totalPages}
              pathOf={(page) => applicationPath(application.id, page)}
              scroll={false}
            />
          )}
        </motion.section>
        <div ref={end} aria-hidden className="h-px" />
      </motion.div>

      <ApplicationActionBar applicationId={application.id} end={end} />

      <InquiryModal
        open={confirming}
        labelledBy="application-delete-title"
        describedBy="application-delete-body"
        width="w-[440px]"
      >
        <h2 id="application-delete-title" className="text-2xl leading-normal font-bold text-text-1">
          지원서를 삭제할까요?
        </h2>
        <p
          id="application-delete-body"
          className="text-base leading-normal font-medium text-text-2"
        >
          삭제하면 되돌릴 수 없어요
        </p>
        {deleteError && (
          <p role="alert" className="text-[13px] leading-normal font-semibold text-danger">
            {deleteError}
          </p>
        )}
        <div className="mt-6 flex gap-2">
          <InquiryButton
            kind="secondary"
            className="flex-1"
            autoFocus
            disabled={deleting}
            onClick={closeConfirm}
          >
            취소
          </InquiryButton>
          <InquiryButton
            kind="primary"
            className="flex-1"
            disabled={deleting}
            aria-busy={deleting || undefined}
            onClick={remove}
          >
            {deleting ? <Spinner size={20} className="bg-white" /> : "삭제"}
            {deleting && <span className="sr-only">삭제</span>}
          </InquiryButton>
        </div>
      </InquiryModal>
    </MotionConfig>
  );
}

/** 면접 기록 한 줄. 결과가 나온 면접만 상세 피드백 · 다시보기로 가고, 분석 중 · 실패는 상태만 보여 준다. */
function SessionRow({ item }: { item: SessionListItem }) {
  const title = applicationSessionTitle(item);
  const pending = pendingLabel(item);
  return (
    <article
      aria-label={title}
      className="-mx-3 flex flex-col gap-2 rounded-xl px-3 py-3.5 leading-normal transition-colors duration-150 hover:bg-surface sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="text-base font-semibold break-keep text-text-1">{title}</h3>
        {!pending && item.summary && (
          <p className="text-[13px] font-medium break-keep text-text-3">{item.summary}</p>
        )}
      </div>
      {pending ? (
        <p className="flex shrink-0 items-center gap-1 text-sm font-semibold text-text-3">
          {item.status === "ANALYZING" && <Spinner size={14} className="bg-current" />}
          {pending}
        </p>
      ) : (
        <div className="flex shrink-0 items-center gap-4 text-sm font-semibold tracking-[-0.2px] text-text-3">
          <SessionLink href={resultPath(item.id)}>상세 피드백</SessionLink>
          <SessionLink href={replayPath(item.id)}>다시보기</SessionLink>
        </div>
      )}
    </article>
  );
}

function SessionLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="group/link flex items-center gap-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {children}
      <span
        aria-hidden
        className="transition-transform duration-150 group-hover/link:translate-x-[3px] motion-reduce:transition-none motion-reduce:group-hover/link:translate-x-0"
      >
        ›
      </span>
    </Link>
  );
}

/** 상세 아래에 붙는 버튼 막대. 페이지 끝(end)이 보이면 한 번 통통 튄다(S07 하단 막대와 같음). */
function ApplicationActionBar({
  applicationId,
  end,
}: {
  applicationId: number;
  end: RefObject<HTMLElement | null>;
}) {
  const reduce = useReducedMotion();
  // 아래 막대(높이 96)에 가려진 동안은 끝에 닿지 않은 것으로 본다.
  const reached = useInView(end, { once: true, margin: "0px 0px -96px 0px" });
  const [scope, animate] = useAnimate<HTMLAnchorElement>();
  const bounced = useRef(false);

  useEffect(() => {
    if (!reached || reduce || bounced.current || !scope.current) return;
    bounced.current = true;
    // 시작값과 끝값이 같은 키프레임을 바로 시작하면 Motion 14가 GPU로 돌리다 요소가 안 그려질 수 있어 두 번에 나눈다(S07과 같음).
    animate([
      [scope.current, { scale: 1.06 }, { duration: 0.2, ease: "easeOut" }],
      [scope.current, { scale: 1 }, { duration: 0.2, ease: "easeIn" }],
    ]);
  }, [reached, reduce, animate, scope]);

  return (
    <div className="sticky bottom-0 z-10 shrink-0 border-t border-line bg-bg">
      <div className="mx-auto flex h-24 w-full max-w-[912px] items-center px-4">
        <Link
          ref={scope}
          href={interviewerPath(applicationId)}
          className="flex h-15 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-brand-strong px-4 text-base leading-normal font-bold tracking-[-0.2px] text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:px-6 sm:text-lg"
        >
          이 지원서로 면접 보기
          <MaskIcon src="/home/icon-arrow-right.svg" size={20} className="bg-white" />
        </Link>
      </div>
    </div>
  );
}
