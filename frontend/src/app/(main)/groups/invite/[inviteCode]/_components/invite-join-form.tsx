"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";

import { useRequestKey } from "@/components/use-request-key";
import { joinGroup } from "@/lib/group/actions";
import { JOB_CATEGORIES, jobCategoryLabel } from "@/lib/group/job-categories";
import { groupJoinSchema, type GroupJoinValues } from "@/lib/group/schemas";
import { MODE_SHORT_LABEL } from "@/lib/interview/modes";
import { PERSONAS } from "@/lib/interview/personas";
import { ROUTES } from "@/lib/routes";
import type { ApplicationListItem, InviteResponse } from "@/types/api";

import { ApplicationPicker } from "../../../_components/application-picker";
import { ChoiceChips } from "../../../_components/choice-chips";
import {
  GroupActionBar,
  GroupBackLink,
  GroupPrimaryButton,
} from "../../../_components/group-action-bar";

// 기준: Figma [초안] G03 초대 확인 · 참가(484:2552: '○○ 님이 그룹 면접에 초대했어요' 26 Bold · 설명 15 · 요약 카드(면접관 · 면접 방식
// · 그룹 직군 · 인원 n/정원) · 내 지원서 · 내 직군 칩 · 직군이 다르면 노란 안내 '그룹 직군(개발)과 달라요. 공통 질문이 내 직군과 조금
// 다를 수 있지만 참가할 수 있어요' · 아래 [취소] · [참가하기])
// · BE Swagger 10.2 초대 확인 · 10.3 그룹 참가(Idempotency-Key · 404 · 409 GROUP_FULL · ALREADY_IN_GROUP → 서버 문구)
// · 사용자 결정(2026-11-13: 지원서는 한 줄 칸 + [변경] 모달 · 빈칸 기본안: 내 직군은 그룹 직군을 골라 둔다)
// 지원서는 최근 작성순 목록(4.3)의 첫 지원서를 골라 둔다. [취소]는 홈으로 간다(사용자 결정 2026-11-12: 나가면 홈).

const JOB_CHOICES = JOB_CATEGORIES.map(({ jobCategory, label }) => ({ value: jobCategory, label }));

type FormValues = Omit<GroupJoinValues, "applicationId"> & { applicationId: number | null };

export function InviteJoinForm({
  inviteCode,
  invite,
  applications,
}: Readonly<{
  inviteCode: string;
  invite: InviteResponse;
  applications: readonly ApplicationListItem[];
}>) {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string>();
  // 10.3 멱등 키: 같은 본문을 다시 보내면 같은 키, 본문이 바뀌었거나 서버가 실패로 답했으면 새 키
  const requestKey = useRequestKey();
  const form = useForm<FormValues, unknown, GroupJoinValues>({
    // 지원서가 없으면(null) 스키마가 거절한다(지원서가 없으면 [참가하기]도 꺼 둔다).
    resolver: zodResolver(groupJoinSchema) as unknown as Resolver<
      FormValues,
      unknown,
      GroupJoinValues
    >,
    defaultValues: {
      inviteCode,
      applicationId: applications[0]?.id ?? null,
      jobCategory: invite.jobCategory,
    },
  });
  const [jobCategory, applicationId] = useWatch({
    control: form.control,
    name: ["jobCategory", "applicationId"],
  });
  const personaName = PERSONAS.find((info) => info.persona === invite.persona)?.name;

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      setFormError(undefined);
      const result = await joinGroup(values, requestKey.keyFor(values));
      if (result.formError) setFormError(result.formError);
      if (result.keySpent) requestKey.spend();
    }),
  );

  const summary = [
    { label: "면접관", value: personaName },
    { label: "면접 방식", value: MODE_SHORT_LABEL[invite.mode] },
    { label: "그룹 직군", value: jobCategoryLabel(invite.jobCategory) },
    { label: "인원", value: `${invite.participantCount}/${invite.capacity}명` },
  ];

  return (
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center px-4 pt-10 pb-10">
        <div className="flex w-full max-w-[640px] flex-col gap-6">
          <div className="flex flex-col gap-1.5 leading-normal">
            <h1 className="text-[26px] font-bold text-text-1">
              {invite.hostNickname} 님이 그룹 면접에 초대했어요
            </h1>
            <p className="text-[15px] font-medium text-text-2">
              내 지원서로 질문을 준비한 뒤 함께 면접을 봐요
            </p>
          </div>

          <dl
            aria-label="그룹 정보"
            className="flex flex-col gap-2.5 rounded-2xl border border-line bg-bg-sub px-4 py-3.5 text-[13px] leading-normal"
          >
            {summary.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between gap-3">
                <dt className="font-medium text-text-3">{label}</dt>
                <dd className="font-bold text-text-1">{value}</dd>
              </div>
            ))}
          </dl>

          <Controller
            control={form.control}
            name="applicationId"
            render={({ field }) => (
              <ApplicationPicker
                applications={applications}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={form.control}
            name="jobCategory"
            render={({ field }) => (
              <ChoiceChips
                legend="내 직군"
                name="jobCategory"
                choices={JOB_CHOICES}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          {jobCategory !== invite.jobCategory && (
            <p className="rounded-xl bg-gold-soft px-3.5 py-3 text-[13px] leading-normal font-medium text-gold-ink dark:bg-gold-soft/9">
              그룹 직군({jobCategoryLabel(invite.jobCategory)})과 달라요. 공통 질문이 내 직군과 조금
              다를 수 있지만 참가할 수 있어요
            </p>
          )}

          <AnimatePresence initial={false}>
            {formError && (
              <motion.p
                key={formError}
                role="alert"
                className="text-sm leading-normal font-semibold text-danger"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, x: [-4, 4, -2, 2, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35 }}
              >
                {formError}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      <GroupActionBar>
        <GroupBackLink href={ROUTES.home}>취소</GroupBackLink>
        <GroupPrimaryButton disabled={applicationId === null} pending={pending}>
          참가하기
        </GroupPrimaryButton>
      </GroupActionBar>
    </form>
  );
}
