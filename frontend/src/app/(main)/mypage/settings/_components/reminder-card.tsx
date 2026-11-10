"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { MaskIcon } from "@/components/mask-icon";
import { changePracticeAlarmTime, disablePracticeAlarm, startKakaoAlarm } from "@/lib/user/actions";
import { practiceAlarmTimeSchema, type PracticeAlarmTimeValues } from "@/lib/user/schemas";
import { useToastStore } from "@/stores/toast-store";
import type { PracticeAlarmResponse } from "@/types/api";

import { OutlineButton, RowArrow, RowError, TextButton } from "./settings-ui";

// 기준: Figma S09-1 Kakao Reminder · 2.8(18:3223: bg-sub · line 테두리 · 둥글기 20 · 패딩 24 · 간격 14 · 아이콘 44(둥글기 12 · 말풍선 20)
// · '카카오톡 연습 알림' 16 Bold · 🔒 '카카오 연결 필요' 칩 · '카카오 계정 연결이 필요한 기능이에요' 14 Medium text-3 · Disabled Row
// (opacity .5 · 좌우 16 · 위아래 12 · 둥글기 12 · '알림 시간' 15 SemiBold · '매일 21:00' 15 Medium · Toggle Off 44×26))
// · S09-1-B(436:2104: 아이콘 brand-soft(다크 447:2333 brand-soft 8%) · 말풍선 brand-strong · 제목 text-1 · '연습하지 않았다면 카카오톡으로 알려드릴게요' text-2
// · Time Row(text-1 · '매일 21:00 ›') · Toggle On(brand-strong · 손잡이 오른쪽)) · Swagger 2.8 연습 알림 설정(available · enabled · time)
// · 2.9 켜기(카카오 동의 scope=talk_message → 콜백) · 2.10 시각 변경(HH:mm, 꺼져 있어도 저장) · 2.11 끄기
// · 기획 메모 S09-1(18:1251: available false면 토글 · 시간 비활성) · S09-1-B(428:2146: 토글은 enabled, 시간은 time을 그대로,
// 꺼진 상태도 시간 ›는 누를 수 있음, 오류는 토스트(S09-2 유지권 오류와 같은 방식) · 토글 · 시각은 그대로)
// · 모션 메모 S09-1(18:3261: available false면 비활성 · 누르면 아무 일 없음, 알림 시간 ›는 닉네임처럼 행에서 인라인 편집)

export function ReminderCard({ alarm }: Readonly<{ alarm: PracticeAlarmResponse }>) {
  const { available } = alarm;
  // 카카오 동의 화면에서 뒤로 가기로 돌아오면 브라우저가 페이지를 그대로 되살려(bfcache) 토글이 진행 중인 채 굳는다.
  // 그때는 줄을 새로 만들어 다시 누를 수 있게 한다.
  const [restored, setRestored] = useState(0);
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRestored((count) => count + 1);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  return (
    <div className="flex w-full flex-col gap-3.5 rounded-[20px] border border-line bg-bg-sub p-6">
      <div className="flex w-full items-start gap-3.5">
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
            available ? "bg-brand-soft dark:bg-brand-soft/8" : "bg-surface"
          }`}
        >
          <MaskIcon
            src="/mypage/icon-kakao-talk.svg"
            size={20}
            className={available ? "bg-brand-strong" : "bg-text-3"}
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1 tracking-[-0.2px]">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className={`text-base leading-normal font-bold ${
                available ? "text-text-1" : "text-text-2"
              }`}
            >
              카카오톡 연습 알림
            </h3>
            {!available && (
              <span className="flex items-center gap-1 rounded-full bg-surface px-2.5 py-1">
                <MaskIcon src="/mypage/icon-lock-xs.svg" size={12} className="bg-text-3" />
                <span className="text-xs leading-normal font-bold text-text-3">
                  카카오 연결 필요
                </span>
              </span>
            )}
          </div>
          <p
            id="reminder-description"
            className={`text-sm leading-normal font-medium break-keep ${
              available ? "text-text-2" : "text-text-3"
            }`}
          >
            {available
              ? "연습하지 않았다면 카카오톡으로 알려드릴게요"
              : "카카오 계정 연결이 필요한 기능이에요"}
          </p>
        </div>
      </div>
      {available ? <TimeRow key={restored} alarm={alarm} /> : <DisabledRow time={alarm.time} />}
    </div>
  );
}

/** 카카오로 가입하지 않은 회원(2.8 available false): 시간 · 토글을 누를 수 없다 */
function DisabledRow({ time }: Readonly<{ time: string }>) {
  return (
    <div className="flex w-full items-center gap-2.5 rounded-xl bg-bg-sub px-4 py-3 tracking-[-0.2px] opacity-50">
      <span className="text-[15px] leading-normal font-semibold text-text-1">알림 시간</span>
      <span className="flex-1" />
      <span className="text-[15px] leading-normal font-medium text-text-3">매일 {time}</span>
      <Toggle on={false} disabled describedBy="reminder-description" />
    </div>
  );
}

function TimeRow({ alarm }: Readonly<{ alarm: PracticeAlarmResponse }>) {
  const notify = useToastStore((state) => state.show);
  const [editing, setEditing] = useState(false);
  const [toggling, startToggle] = useTransition();
  const [saving, startSaving] = useTransition();
  // 편집을 닫으면 다시 나타나는 '매일 HH:mm ›' 버튼에 포커스를 준다(키보드로 쓰던 자리를 잃지 않게).
  // autoFocus는 사라지던 줄이 다시 쓰이면(AnimatePresence) 불리지 않아, 닫힌 뒤 직접 준다.
  const [closed, setClosed] = useState(false);
  const timeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (closed && !editing) timeButton.current?.focus();
  }, [closed, editing]);
  const form = useForm<PracticeAlarmTimeValues>({
    resolver: zodResolver(practiceAlarmTimeSchema),
    defaultValues: { time: alarm.time },
  });
  const error = form.formState.errors.time?.message;

  function open() {
    form.reset({ time: alarm.time });
    setEditing(true);
  }

  function close() {
    if (saving) return;
    form.clearErrors();
    setClosed(true);
    setEditing(false);
  }

  // 켜기는 카카오 메시지 동의 화면으로 갔다가 콜백(2.9)으로 돌아온다. 끄기는 바로 2.11.
  function toggle() {
    startToggle(async () => {
      const result = alarm.enabled ? await disablePracticeAlarm() : await startKakaoAlarm();
      if (result?.error) notify({ text: result.error });
    });
  }

  const submit = form.handleSubmit((values) =>
    startSaving(async () => {
      const result = await changePracticeAlarmTime(values);
      if (result.error) {
        notify({ text: result.error });
        return;
      }
      setClosed(true);
      setEditing(false);
    }),
  );

  return (
    <div className="flex flex-col">
      <AnimatePresence mode="popLayout" initial={false}>
        {editing ? (
          <motion.form
            key="editing"
            onSubmit={submit}
            noValidate
            className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-2 rounded-xl bg-bg-sub px-4 py-[5px] tracking-[-0.2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <label
              htmlFor="alarm-time"
              className="text-[15px] leading-normal font-semibold text-text-1"
            >
              알림 시간
            </label>
            <span className="flex-1" />
            <input
              id="alarm-time"
              type="time"
              step={60}
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "alarm-time-error" : undefined}
              onKeyDown={(event) => {
                if (event.key === "Escape") close();
              }}
              {...form.register("time")}
              className={`h-10 min-w-32 rounded-[10px] border bg-bg-sub px-3 text-[15px] leading-normal font-medium text-text-1 outline-none focus:border-brand focus:ring-1 focus:ring-brand ${
                error ? "border-danger ring-1 ring-danger" : "border-line"
              }`}
            />
            {/* 좁은 화면에서 줄이 감기면 두 버튼이 함께 다음 줄 오른쪽으로 간다 */}
            <span className="ml-auto flex items-center gap-2.5">
              <OutlineButton type="submit" disabled={saving} aria-busy={saving || undefined}>
                저장
              </OutlineButton>
              <TextButton onClick={close} disabled={saving}>
                취소
              </TextButton>
            </span>
          </motion.form>
        ) : (
          <motion.div
            key="view"
            className="flex w-full items-center gap-2.5 rounded-xl bg-bg-sub py-3 pl-4 tracking-[-0.2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <span className="text-[15px] leading-normal font-semibold text-text-1">알림 시간</span>
            <span className="flex-1" />
            <button
              ref={timeButton}
              type="button"
              onClick={open}
              aria-label={`알림 시간 매일 ${alarm.time}, 바꾸기`}
              className="group/row flex cursor-pointer items-center gap-2.5 rounded-md text-[15px] leading-normal font-medium text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              매일 {alarm.time}
              <RowArrow />
            </button>
            <span className="pr-4">
              <Toggle on={alarm.enabled} pending={toggling} onClick={toggle} />
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      {editing && <RowError id="alarm-time-error">{error}</RowError>}
    </div>
  );
}

function Toggle({
  on,
  disabled = false,
  pending = false,
  describedBy,
  onClick,
}: Readonly<{
  on: boolean;
  disabled?: boolean;
  pending?: boolean;
  /** 누를 수 없는 이유를 읽어 줄 설명 문구 id */
  describedBy?: string;
  onClick?: () => void;
}>) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="카카오톡 연습 알림"
      aria-busy={pending || undefined}
      aria-describedby={describedBy}
      disabled={disabled || pending}
      onClick={onClick}
      className={`flex h-[26px] w-11 shrink-0 cursor-pointer items-center rounded-full p-[3px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed ${
        on ? "justify-end bg-brand-strong" : "justify-start bg-line"
      }`}
    >
      <motion.span layout className="size-5 rounded-full bg-white" />
    </button>
  );
}
