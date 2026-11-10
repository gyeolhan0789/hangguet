"use client";

import { motion, useReducedMotion } from "motion/react";
import Form from "next/form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PracticeActionBar, PracticeNextButton } from "@/components/practice/practice-action-bar";
import { PracticeSteps } from "@/components/practice/practice-steps";
import { applicationDate } from "@/lib/application/format";
import { applicationNewPath, ROUTES } from "@/lib/routes";
import type { ApplicationListItem } from "@/types/api";

// 기준: Figma S03 지원서 선택(화이트 · 다크: S03 지원서 입력의 회사명 · 직무 · 자기소개서 칸을 지원서 고르기로 바꾼 화면 —
// '지원서' 14 Bold text-2(간격 12) · 목록 상자 bg-sub · 둥글기 20 · 좌우 24 · 위아래 4 · 줄 사이 1px line,
// 줄 위아래 18 · 간격 14: 라디오 22(고름: brand 테두리 2 + 점 10 / 안 고름: line 테두리 1.5) + '회사 · 직무' 16 SemiBold · 작성일 13 Medium text-3
// · [+ 추가하기](surface · 높이 56 · 둥글기 14 · 17 Bold, 목록과 같은 폭) · 아래 막대 [← 홈으로] · [다음: 면접관 선택])
// · 기획 메모 S03 지원서 선택(기존 S03 지원서 입력을 대체, 지원서에 회사 · 직무 · 자기소개서가 다 있어 입력칸 없음,
//   [+ 추가하기]는 항상 보임 → 지원서 쓰기, 고른 지원서 id로 5.1)
// · 모션 메모 S03 지원서 선택(첫 등장 줄마다 y 16→0 stagger 0.06s, 고르면 라디오 점 scale 0→1 + 줄 배경 살짝 진해짐
//   spring stiffness 400 · damping 30, 고르면 [다음]이 주황으로 채워지며 팝, 지원서 쓰기에서 저장하고 돌아오면 새 지원서 줄만
//   y -8→0 · opacity로 나타나고 골라 둔 상태 — 4.3이 최근 작성순이라 맨 위 줄)
// · Swagger 4.3 ApplicationListItem · 사용자 결정(2026-10-29: 4.3을 size 20으로 한 번만, 빈 목록이면 '저장된 지원서가 없어요')

type SelectProps = {
  applications: ApplicationListItem[];
  /** 이미 고른 지원서(S04 [← 지원서 선택] · 지원서 쓰기 저장 뒤) */
  initialSelected: number | null;
  /** initialSelected가 지원서 쓰기에서 막 저장하고 돌아온 지원서인지 */
  added: boolean;
};

/**
 * 줄이 처음 나타나는 모습. 지원서 쓰기에서 저장하고 돌아왔으면 새 지원서 줄만 위에서 내려오고(나머지는 그대로),
 * 아니면 모든 줄이 아래에서 올라온다(모션 메모 S03 지원서 선택).
 */
function entrance(added: boolean, isNew: boolean) {
  if (!added) return { y: 16, opacity: 0 };
  return isNew && { y: -8, opacity: 0 };
}

/**
 * S03 지원서 선택. 한 번 본 화면은 고른 값을 살려 다시 보여 주므로(cacheComponents · Activity), 새로 들어올 때마다
 * (push · replace) 새로 그려 첫 등장 연출과 '아무것도 고르지 않음([다음] 회색)'부터 시작한다. 뒤로 · 앞으로 가기로
 * 돌아오면 고른 값을 그대로 둔다(Next useRouter().bfcacheId — 지원서 쓰기와 같은 방식).
 */
export function ApplicationSelect(props: Readonly<SelectProps>) {
  const { bfcacheId } = useRouter();
  return <Select key={bfcacheId} {...props} />;
}

function Select({ applications, initialSelected, added }: Readonly<SelectProps>) {
  const reduce = useReducedMotion();
  const [picked, setPicked] = useState(initialSelected);
  // 한 번 본 화면은 고른 값이 남으므로(Activity), 그사이 목록에서 빠진 지원서(삭제 등)는 고르지 않은 것으로 본다.
  const selected = applications.some((application) => application.id === picked) ? picked : null;

  return (
    <Form action={ROUTES.practiceInterviewer} className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center gap-8 px-4 pt-8 pb-10">
        <PracticeSteps current={1} />

        <div className="flex w-full max-w-[760px] flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-[32px] leading-[1.3] font-extrabold tracking-[-0.8px] text-text-1">
              어떤 면접을 준비하나요?
            </h1>
            <p className="text-[17px] leading-normal font-medium tracking-[-0.2px] text-text-2">
              지원서를 바탕으로 질문과 평가 기준을 만들어요
            </p>
          </div>

          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="mb-3 text-sm leading-normal font-bold tracking-[-0.2px] text-text-2">
              지원서
            </legend>
            {applications.length === 0 ? (
              <p className="w-full rounded-[20px] bg-bg-sub px-6 py-7 text-center text-[15px] leading-normal font-medium text-text-3">
                저장된 지원서가 없어요
              </p>
            ) : (
              <ul className="flex w-full flex-col rounded-[20px] bg-bg-sub px-6 py-1">
                {applications.map((application, i) => {
                  const on = selected === application.id;
                  return (
                    <motion.li
                      key={application.id}
                      className="border-b border-line last:border-b-0"
                      initial={reduce ? false : entrance(added, application.id === initialSelected)}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.3, ease: "easeOut", delay: added ? 0 : i * 0.06 }}
                    >
                      {/* 라디오(왼쪽, 두 줄 가운데) · 회사 · 직무(위) · 작성일(아래)의 두 칸 격자. 글이 라벨 바로 아래에 있어야
                          보조기기 · 검사 도구가 라벨 이름으로 읽는다 */}
                      <label
                        className={`-mx-3 grid cursor-pointer grid-cols-[22px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-0.5 rounded-xl px-3 py-[18px] transition-colors duration-200 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand ${on ? "bg-surface" : ""}`}
                      >
                        <input
                          type="radio"
                          name="applicationId"
                          value={application.id}
                          checked={on}
                          onChange={() => setPicked(application.id)}
                          className="sr-only"
                        />
                        <span
                          aria-hidden
                          className={`row-span-2 flex size-[22px] items-center justify-center rounded-full border-solid transition-colors ${on ? "border-2 border-brand-strong" : "border-[1.5px] border-line"}`}
                        >
                          <motion.span
                            className="size-2.5 rounded-full bg-brand-strong"
                            initial={false}
                            animate={{ scale: on ? 1 : 0 }}
                            transition={{ type: "spring", stiffness: 400, damping: 30 }}
                          />
                        </span>
                        <span className="truncate text-base leading-normal font-semibold text-text-1">
                          {application.companyName} · {application.jobTitle}
                        </span>
                        <span className="text-[13px] leading-normal font-medium text-text-3">
                          {applicationDate(application.createdAt)}
                        </span>
                      </label>
                    </motion.li>
                  );
                })}
              </ul>
            )}
            <Link
              href={applicationNewPath("practice")}
              className="flex h-14 w-full items-center justify-center rounded-[14px] bg-surface text-[17px] leading-normal font-bold tracking-[-0.2px] text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              + 추가하기
            </Link>
          </fieldset>
        </div>
      </div>

      <PracticeActionBar backHref={ROUTES.home} backLabel="홈으로">
        <PracticeNextButton disabled={selected === null}>다음: 면접관 선택</PracticeNextButton>
      </PracticeActionBar>
    </Form>
  );
}
