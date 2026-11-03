"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useState, type ComponentProps, type KeyboardEvent } from "react";

import type { CompanyItem } from "@/types/api";

// 기준: Swagger 4.7 회사 목록(CompanyItem: 영문 다음 한글 가나다순, aliases는 띄어쓰기 · (주) 등을 빼고 소문자로 맞춘 값)
// · 사용자 결정(2026-11-03: Figma에 없어 회사명 칸 아래 목록. 비어 있으면 전체, 입력하면 회사명 · 별칭에 든 회사만 보여 주고
//   별칭으로 찾으면 이름 옆에 그 별칭, 맞는 글자는 brand-ink, 없으면 아직 수집되지 않은 회사라는 안내. 목록에 없는 회사도 그대로 쓰고,
//   목록을 못 불러오면 일반 입력칸) · 목록 상자 · 줄 · 빈 문구 · 열고 닫는 연출은 헤더 공지 메뉴(C03)와 같다
// · 참고: WAI-ARIA APG Combobox(목록 자동 완성) — 방향키로 고르고 Enter로 넣고 Esc로 닫는다

/** BE CompanyCardFinder · 파이프라인 candidates.key와 같은 규칙 */
const DROP = /\(주\)|㈜|주식회사|co\.?,?\.?\s*ltd\.?|corp(oration)?\.?|inc\.?|[\s.,·-]/giu;
const NOT_LISTED = "아직 데이터가 수집되지 않은 회사입니다. 추후 업데이트를 기다려주세요";

function normalize(text: string) {
  return text.replace(DROP, "").toLowerCase();
}

interface Match {
  company: CompanyItem;
  /** 회사명에 없고 별칭에만 있을 때 그 별칭 */
  alias?: string;
}

/** 회사명이나 별칭에 query가 든 회사 */
function search(companies: CompanyItem[], query: string): Match[] {
  if (!query) return companies.map((company) => ({ company }));
  return companies.flatMap((company): Match[] => {
    if (normalize(company.name).includes(query)) return [{ company }];
    const alias = company.aliases.find((name) => name.includes(query));
    return alias ? [{ company, alias }] : [];
  });
}

/** 정규화한 query가 맞는 글자를 칠한다. 띄어쓰기 · (주) 등 빠지는 글자를 건너뛰며 원래 글자 위치를 찾는다 */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return text;
  const dropped = new Set<number>();
  for (const { index, 0: hit } of text.matchAll(DROP)) {
    for (let i = index; i < index + hit.length; i++) dropped.add(i);
  }
  const kept = Array.from({ length: text.length }, (_, i) => i).filter((i) => !dropped.has(i));
  const at = kept
    .map((i) => text[i])
    .join("")
    .toLowerCase()
    .indexOf(query);
  if (at < 0) return text;
  const start = kept[at];
  const end = kept[at + query.length - 1] + 1;
  return (
    <>
      {text.slice(0, start)}
      <mark className="bg-transparent text-brand-ink">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

/** 회사명 칸. 회사 목록이 없으면 일반 입력칸이다 */
export function CompanyCombobox({
  companies,
  value,
  onValueChange,
  ...input
}: Omit<ComponentProps<"input">, "value" | "onChange"> & {
  companies: CompanyItem[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const query = normalize(value);
  const matches = search(companies, query);
  // 맞는 회사가 없으면 목록(listbox) 없이 안내 문구만 보인다
  const expanded = open && matches.length > 0;
  const optionId = (index: number) => `${listId}-${index}`;

  useEffect(() => {
    if (active >= 0) {
      document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [active, listId]);

  if (companies.length === 0) {
    return <input {...input} value={value} onChange={(e) => onValueChange(e.target.value)} />;
  }

  function close() {
    setOpen(false);
    setActive(-1);
  }

  function pick(name: string) {
    onValueChange(name);
    close();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // 한글을 조합하는 중의 키는 글자를 확정하는 키라 목록을 움직이지 않는다
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      else if (expanded) setActive((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === "ArrowUp" && expanded) {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && expanded && matches[active]) {
      // 고른 회사를 넣기만 하고 폼은 보내지 않는다
      event.preventDefault();
      pick(matches[active].company.name);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  }

  return (
    <div className="relative">
      <input
        {...input}
        value={value}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        onChange={(e) => {
          onValueChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={(e) => {
          input.onFocus?.(e);
          setOpen(true);
        }}
        onBlur={(e) => {
          input.onBlur?.(e);
          close();
        }}
        onKeyDown={onKeyDown}
      />
      {/* 알림 영역은 늘 두고 글만 바꿔야 화면 읽기 프로그램이 새 문구를 읽는다 */}
      <p role="status" className="sr-only">
        {open && matches.length === 0 ? NOT_LISTED : ""}
      </p>
      <AnimatePresence>
        {open && (
          <motion.div
            className="absolute inset-x-0 top-[calc(100%+8px)] z-20 origin-top rounded-2xl border border-line bg-bg-sub p-2 shadow-[0_12px_32px_rgba(0,0,0,0.15)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.4)]"
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -6 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            {matches.length > 0 ? (
              <ul
                id={listId}
                role="listbox"
                aria-label="회사 목록"
                className="flex max-h-[264px] flex-col gap-0.5 overflow-y-auto"
              >
                {matches.map(({ company, alias }, index) => (
                  <li
                    key={company.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === active}
                    // 누르는 동안 입력칸이 포커스를 잃어 목록이 닫히지 않게 한다
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(company.name)}
                    className={`flex cursor-pointer items-baseline gap-2 rounded-[10px] p-3 text-[15px] leading-normal font-semibold text-text-1 transition-colors hover:bg-surface ${index === active ? "bg-surface" : ""}`}
                  >
                    <span>
                      <Highlight text={company.name} query={query} />
                    </span>
                    {alias && (
                      <span className="text-[13px] font-medium text-text-3">
                        <Highlight text={alias} query={query} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p aria-hidden className="p-3 text-[15px] leading-normal font-medium text-text-3">
                {NOT_LISTED}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
