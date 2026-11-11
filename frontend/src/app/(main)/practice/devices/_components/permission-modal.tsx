"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { cycleTabFocus } from "@/components/cycle-tab-focus";
import { MaskIcon } from "@/components/mask-icon";
import { Spinner } from "@/components/spinner";
import { useLockScroll } from "@/components/use-lock-scroll";

// 기준: Figma S05-E 장치 점검 · 권한 거부(18:4013: Dim rgba(25,33,40,.5) · Modal 18:4175 520px · 둥글기 24 · 패딩 32
// · 그림자 0 20 24 rgba(25,33,40,.25) · camera-off 타일 64 · 제목 24 ExtraBold · 설명 15 Medium · 3단계 안내
// · 주소창 예시 · [채팅으로 면접 보기] · [다시 확인하기])
// · 모션 메모 S05-E(18:4221: 0.3s 뒤 모달(dim 페이드 + y 24→0 · scale .96→1), 주소창 예시는 자물쇠 → 팝오버가 차례로
// 하이라이트되는 3단계 루프, [다시 확인하기] → 버튼 안 스피너) · 기획 메모 S05-E(18:3468)

const STEPS = [
  "주소창 왼쪽 자물쇠 아이콘을 눌러요",
  "카메라 · 마이크를 '허용'으로 바꿔요",
  "아래 [다시 확인하기]를 눌러요",
] as const;

/** 안내 단계가 바뀌는 간격 */
export const STEP_LOOP_MS = 1400;
/** 권한 거부를 알아챈 뒤 모달이 뜨기까지(체크 줄이 흔들린 다음) */
const OPEN_DELAY_S = 0.3;

/** 카메라 · 마이크 권한이 거부됐을 때 허용 방법을 알려 주는 모달 */
export function PermissionModal({
  open,
  rechecking,
  onRecheck,
  switchingToChat,
  onChat,
  error,
}: Readonly<{
  open: boolean;
  rechecking: boolean;
  onRecheck: () => void;
  switchingToChat: boolean;
  onChat: () => void;
  /** 채팅 면접으로 바꾸지 못했을 때 문구 */
  error?: string;
}>) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  useLockScroll(open);

  // 안내 단계를 차례로 강조하며 되풀이한다. 동작 줄이기면 멈춘 채로 둔다.
  useEffect(() => {
    if (!open || reduce) return;
    const timer = setInterval(() => setStep((now) => (now + 1) % STEPS.length), STEP_LOOP_MS);
    return () => clearInterval(timer);
  }, [open, reduce]);

  // 모달 안에서만 Tab이 돌게 한다(aria-modal).
  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !dialog.current) return;
    const buttons = [
      ...dialog.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ];
    cycleTabFocus(event, buttons);
  }

  const highlight = (index: number) => !reduce && step === index;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="dim"
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(25,33,40,0.5)] px-4 py-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: OPEN_DELAY_S, duration: 0.2 } }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
        >
          <motion.div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="permission-title"
            aria-describedby="permission-description"
            onKeyDown={trapFocus}
            // 늘어나지 않게 위에 붙이고(items-start) my-auto로 가운데에 둔다. 화면보다 길면 위부터 스크롤된다(items-center는 위쪽이 잘린다).
            className="my-auto flex w-full max-w-[520px] flex-col items-center gap-4 rounded-3xl bg-bg-sub p-6 drop-shadow-[0_20px_24px_rgba(25,33,40,0.25)] sm:p-8"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: { delay: OPEN_DELAY_S, type: "spring", stiffness: 380, damping: 28 },
            }}
            exit={{ opacity: 0, y: 24, scale: 0.96, transition: { duration: 0.2 } }}
            onAnimationComplete={() => {
              if (!dialog.current?.contains(document.activeElement)) {
                dialog.current?.querySelector<HTMLButtonElement>("[data-autofocus]")?.focus();
              }
            }}
          >
            <span className="flex size-16 items-center justify-center rounded-[20px] bg-danger-soft dark:bg-danger-soft/14">
              <MaskIcon src="/devices/icon-camera-off.svg" size={32} className="bg-danger" />
            </span>
            <h2
              id="permission-title"
              className="text-center text-2xl leading-normal font-extrabold tracking-[-0.2px] text-text-1"
            >
              카메라 · 마이크 권한이 필요해요
            </h2>
            <p
              id="permission-description"
              className="text-center text-[15px] leading-normal font-medium tracking-[-0.2px] text-text-2"
            >
              화상 면접은 카메라와 마이크로 진행돼요
            </p>

            <ol className="flex w-full flex-col gap-2.5 rounded-2xl bg-bg-sub p-5">
              {STEPS.map((text, i) => (
                <li
                  key={text}
                  data-highlighted={highlight(i) || undefined}
                  className="flex items-center gap-2.5"
                >
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs leading-normal font-extrabold tracking-[-0.2px] transition-colors duration-300 ${
                      highlight(i)
                        ? "bg-brand-strong text-white"
                        : "bg-brand-soft text-brand-ink dark:bg-brand-soft/8"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="text-[15px] leading-normal font-semibold tracking-[-0.2px] text-text-1">
                    {text}
                  </span>
                </li>
              ))}
            </ol>

            <AddressBarExample lockOn={highlight(0)} allowOn={highlight(1)} />

            {error && (
              <p role="alert" className="text-sm leading-normal font-semibold text-danger">
                {error}
              </p>
            )}

            <div className="flex w-full flex-col-reverse gap-2.5 sm:flex-row">
              <ModalButton
                tone="surface"
                icon={
                  <MaskIcon
                    src="/devices/icon-message-square.svg"
                    size={18}
                    className="bg-text-1"
                  />
                }
                onClick={onChat}
                pending={switchingToChat}
                disabled={rechecking}
              >
                채팅으로 면접 보기
              </ModalButton>
              <ModalButton
                tone="brand"
                icon={<Image src="/devices/icon-rotate-cw.svg" alt="" width={18} height={18} />}
                onClick={onRecheck}
                pending={rechecking}
                disabled={switchingToChat}
                autoFocus
              >
                다시 확인하기
              </ModalButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** 주소창 예시(Figma Address Bar Example 18:4175 안: 자물쇠 · 주소 · 권한 팝오버 '카메라 허용 ▾') */
function AddressBarExample({ lockOn, allowOn }: Readonly<{ lockOn: boolean; allowOn: boolean }>) {
  // 예시 주소는 지금 쓰는 사이트 주소로 보여 준다. 모달은 브라우저에서 권한 거부를 알아챈 뒤에만 그려진다.
  const host =
    typeof window === "undefined" ? "" : `${window.location.host}${window.location.pathname}`;
  const ring = (on: boolean) =>
    `rounded-md ring-2 transition-shadow duration-300 ${on ? "ring-brand" : "ring-transparent"}`;

  return (
    <div
      aria-hidden
      className="flex w-full flex-col gap-2 rounded-[14px] border border-line bg-bg-sub p-3.5"
    >
      <div className="flex h-9 w-full items-center gap-2 rounded-full bg-surface px-3">
        <span className={`flex ${ring(lockOn)}`}>
          <MaskIcon src="/devices/icon-lock.svg" size={14} className="bg-brand-ink" />
        </span>
        <span className="min-w-0 truncate text-[13px] leading-normal font-medium tracking-[-0.2px] text-text-2">
          {host}
        </span>
      </div>
      <div className="flex w-fit items-center gap-4 rounded-[10px] bg-bg-sub px-3 py-2">
        <span className="flex items-center gap-1.5">
          <MaskIcon src="/practice/icon-camera.svg" size={14} className="bg-text-2" />
          <span className="text-[13px] leading-normal font-semibold tracking-[-0.2px] text-text-1">
            카메라
          </span>
        </span>
        <span
          className={`bg-brand-soft px-2 py-[3px] text-xs leading-normal font-bold tracking-[-0.2px] text-brand-ink dark:bg-brand-soft/8 ${ring(allowOn)}`}
        >
          허용 ▾
        </span>
      </div>
    </div>
  );
}

function ModalButton({
  tone,
  icon,
  children,
  onClick,
  pending,
  disabled,
  autoFocus,
}: Readonly<{
  tone: "surface" | "brand";
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  pending: boolean;
  disabled: boolean;
  autoFocus?: boolean;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      data-autofocus={autoFocus || undefined}
      // 세로로 쌓이는 모바일에서 flex-1(flex-basis 0)이 높이 52를 덮지 않게, 가로 배치에서만 나눠 갖는다.
      className={`flex h-[52px] min-w-0 cursor-pointer items-center justify-center gap-2 rounded-[14px] px-6 text-base leading-normal font-bold tracking-[-0.2px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed sm:flex-1 ${
        tone === "brand" ? "bg-brand-strong text-white" : "bg-surface text-text-1"
      }`}
    >
      {pending ? (
        <Spinner size={18} className={tone === "brand" ? "bg-white" : "bg-text-1"} />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
