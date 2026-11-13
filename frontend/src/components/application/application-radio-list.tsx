"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";

import { applicationDate } from "@/lib/application/format";
import { applicationNewPath } from "@/lib/routes";
import type { ApplicationListItem } from "@/types/api";

// 기준: Figma S03 지원서 선택(목록 상자 bg-sub · 둥글기 20 · 좌우 24 · 위아래 4 · 줄 사이 1px line,
// 줄 위아래 18 · 간격 14: 라디오 22(고름: brand 테두리 2 + 점 10 / 안 고름: line 테두리 1.5) + '회사 · 직무' 16 SemiBold · 작성일 13 Medium text-3
// · [+ 추가하기](surface · 높이 56 · 둥글기 14 · 17 Bold, 목록과 같은 폭)) · 모션 메모 S03 지원서 선택(첫 등장 줄마다 y 16→0 stagger 0.06s,
// 고르면 라디오 점 scale 0→1 + 줄 배경 살짝 진해짐, 지원서 쓰기에서 저장하고 돌아오면 새 지원서 줄만 y -8→0)
// · 사용자 결정(2026-10-29: 빈 목록이면 '저장된 지원서가 없어요') · 사용자 결정(2026-11-13: 그룹 만들기 · 참가도 같은 지원서 고르기 UI)
// S03 지원서 선택 · G02 그룹 만들기 · G03 초대 참가가 같이 쓴다.

/**
 * 줄이 처음 나타나는 모습. 지원서 쓰기에서 저장하고 돌아왔으면 새 지원서 줄만 위에서 내려오고(나머지는 그대로),
 * 아니면 모든 줄이 아래에서 올라온다(모션 메모 S03 지원서 선택).
 */
function entrance(added: boolean, isNew: boolean) {
  if (!added) return { y: 16, opacity: 0 };
  return isNew && { y: -8, opacity: 0 };
}

export function ApplicationRadioList({
  legend,
  applications,
  selected,
  onSelect,
  name = "applicationId",
  newId = null,
  addHref = applicationNewPath("practice"),
  inDialog = false,
}: Readonly<{
  /** 칸 이름(S03 '지원서' · G02 · G03 '내 지원서') */
  legend: string;
  applications: readonly ApplicationListItem[];
  selected: number | null;
  onSelect: (applicationId: number) => void;
  /** 라디오 name. 폼 제출 값으로 쓴다(S03은 applicationId로 S04에 넘긴다) */
  name?: string;
  /** 지원서 쓰기에서 막 저장하고 돌아온 지원서. 그 줄만 새로 나타나는 연출을 한다 */
  newId?: number | null;
  /** [+ 추가하기]로 갈 지원서 쓰기 주소(저장 뒤 돌아올 곳이 다르다) */
  addHref?: string;
  /** 모달 안: 제목('지원서 선택')이 따로 있어 칸 이름은 화면에서 숨긴다(읽기 프로그램에는 남김) */
  inDialog?: boolean;
}>) {
  const reduce = useReducedMotion();
  const added = newId !== null;
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend
        className={
          inDialog
            ? "sr-only"
            : "mb-3 text-sm leading-normal font-bold tracking-[-0.2px] text-text-2"
        }
      >
        {legend}
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
                initial={reduce ? false : entrance(added, application.id === newId)}
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
                    name={name}
                    value={application.id}
                    checked={on}
                    onChange={() => onSelect(application.id)}
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
        href={addHref}
        className="flex h-14 w-full items-center justify-center rounded-[14px] bg-surface text-[17px] leading-normal font-bold tracking-[-0.2px] text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        + 추가하기
      </Link>
    </fieldset>
  );
}
