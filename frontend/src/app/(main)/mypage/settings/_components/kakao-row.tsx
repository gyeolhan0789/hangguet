"use client";

import { useEffect, useRef, useState, useTransition, type Ref } from "react";

import { dismissNotice } from "@/lib/auth/social-actions";
import { startKakaoLink, unlinkKakao } from "@/lib/user/actions";
import { useToastStore } from "@/stores/toast-store";
import type { MeResponse } from "@/types/api";

import { dialogButtonClass, SettingsDialog } from "./settings-dialog";
import { pressableRow, RowArrow, rowTitle, TextButton } from "./settings-ui";

// S09-1 계정 카드의 카카오 줄. 기준: Figma S09-1 Row 카카오(436:2096: '카카오' 16 SemiBold · 오른쪽 15 Medium text-3) · S09-1-B(436:2104:
// '연결됨') · 웹 Swagger 2.1 내 정보(socialProvider · linkedProvider) · 2.12 소셜 계정 연결(카카오 인가 코드 → 콜백) · 2.13 연결 해제
// (204, 켜 둔 연습 알림도 꺼짐, 소셜 회원은 409 PASSWORD_NOT_SET) · 사용자 결정: 이메일 회원은 '연결하기 ›'를 눌러 카카오 동의 → 2.12 →
// S09-1로 돌아와 '연결이 완료되었어요' [확인] 안내 모달, 연결한 이메일 회원은 '연결됨' 옆 '연결 해제' → 확인 모달
// ('카카오 연결을 해제할까요?' · '켜 둔 연습 알림도 꺼져요' · [취소] [해제하기]) → 2.13, 카카오로 가입한 회원은 '연결됨'만(해제 없음),
// 실패는 서버 문구 토스트

const statusText = "text-[15px] leading-normal font-medium tracking-[-0.2px] text-text-3";

export function KakaoRow({
  me,
  linked = false,
}: Readonly<{
  me: MeResponse;
  /** 카카오 동의 화면에서 2.12로 연결하고 막 돌아왔다(콜백이 쿠키로 넘긴다). 완료 안내 모달을 한 번 띄운다 */
  linked?: boolean;
}>) {
  if (me.socialProvider === "KAKAO") {
    return (
      <div className="flex items-center gap-2.5 py-[18px]">
        <span className={rowTitle}>카카오</span>
        <span className="flex-1" />
        <span className={statusText}>연결됨</span>
      </div>
    );
  }
  return <EmailMemberRow connected={me.linkedProvider === "KAKAO"} linked={linked} />;
}

function EmailMemberRow({ connected, linked }: Readonly<{ connected: boolean; linked: boolean }>) {
  const notify = useToastStore((state) => state.show);
  const [unlinking, startUnlinking] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(linked);
  // 카카오 화면에서 뒤로 가기로 돌아오면(bfcache) 넘어가던 상태(처리 중)가 그대로 남아 있어, 그때 줄을 새로 그린다.
  const [restored, setRestored] = useState(0);
  const linkButton = useRef<HTMLButtonElement>(null);
  const unlinkButton = useRef<HTMLButtonElement>(null);
  // 해제하고 '연결하기'로 바뀌면 그 줄로 포커스를 준다(모달 안 [해제하기]에 있던 키보드 자리를 잃지 않게)
  const [unlinked, setUnlinked] = useState(false);

  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setRestored((count) => count + 1);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // 보여 준 완료 표시는 지워서, 새로 고치면 다시 뜨지 않게 한다.
  useEffect(() => {
    if (linked) void dismissNotice();
  }, [linked]);

  useEffect(() => {
    if (unlinked && !connected) linkButton.current?.focus();
  }, [unlinked, connected]);

  function closeConfirm() {
    setConfirming(false);
    unlinkButton.current?.focus();
  }

  // 안내를 닫으면 '연결됨' 줄의 [연결 해제]로 포커스를 준다(사라진 [확인]에 있던 키보드 자리를 잃지 않게)
  function closeDone() {
    setDone(false);
    unlinkButton.current?.focus();
  }

  function unlink() {
    startUnlinking(async () => {
      const result = await unlinkKakao();
      if (result.error) {
        notify({ text: result.error });
        closeConfirm();
        return;
      }
      setConfirming(false);
      setUnlinked(true);
    });
  }

  return (
    <>
      {connected ? (
        <div className="flex items-center gap-2.5 py-[18px]">
          <span className={rowTitle}>카카오</span>
          <span className="flex-1" />
          <span className={statusText}>연결됨</span>
          <TextButton ref={unlinkButton} onClick={() => setConfirming(true)}>
            연결 해제
          </TextButton>
        </div>
      ) : (
        <LinkButton key={restored} ref={linkButton} />
      )}

      <SettingsDialog
        open={confirming}
        title="카카오 연결을 해제할까요?"
        description="켜 둔 연습 알림도 꺼져요"
        busy={unlinking}
        onClose={closeConfirm}
      >
        <button
          type="button"
          autoFocus
          onClick={closeConfirm}
          disabled={unlinking}
          className={dialogButtonClass.secondary}
        >
          취소
        </button>
        <button
          type="button"
          onClick={unlink}
          disabled={unlinking}
          aria-busy={unlinking || undefined}
          className={dialogButtonClass.danger}
        >
          해제하기
        </button>
      </SettingsDialog>

      <SettingsDialog open={done} title="연결이 완료되었어요" onClose={closeDone}>
        <button type="button" autoFocus onClick={closeDone} className={dialogButtonClass.primary}>
          확인
        </button>
      </SettingsDialog>
    </>
  );
}

/** 이메일 회원의 '연결하기 ›'. 누르면 카카오 동의 화면으로 넘어가고, 넘어가는 동안 다시 누를 수 없다 */
function LinkButton({ ref }: Readonly<{ ref: Ref<HTMLButtonElement> }>) {
  const notify = useToastStore((state) => state.show);
  const [linking, startLinking] = useTransition();

  function link() {
    startLinking(async () => {
      const result = await startKakaoLink();
      if (result?.error) notify({ text: result.error });
    });
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={link}
      disabled={linking}
      aria-busy={linking || undefined}
      className={`${pressableRow} disabled:cursor-not-allowed`}
    >
      <span className={rowTitle}>카카오</span>
      <span className="flex-1" />
      <span className={statusText}>연결하기</span>
      <RowArrow />
    </button>
  );
}
