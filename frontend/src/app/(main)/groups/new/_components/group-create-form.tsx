"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { useRequestKey } from "@/components/use-request-key";
import { createGroup } from "@/lib/group/actions";
import { JOB_CATEGORIES } from "@/lib/group/job-categories";
import { GROUP_CAPACITIES, groupCreateSchema, type GroupCreateValues } from "@/lib/group/schemas";
import { modePath } from "@/lib/routes";
import type { ApplicationListItem, Mode, Persona } from "@/types/api";

import { ApplicationPicker } from "../../_components/application-picker";
import { ChoiceChips } from "../../_components/choice-chips";
import {
  GroupActionBar,
  GroupBackLink,
  GroupPrimaryButton,
} from "../../_components/group-action-bar";

// 기준: Figma [초안] G02 그룹 만들기(484:2318: 제목 '함께 면접 볼 그룹을 만들어요' 26 Bold · 설명 15 · 폭 640 · 칸 사이 24
// · 내 지원서 · 인원 2명 · 3명(3명 골라 둠) · 그룹 직군('개발' 골라 둠) · 아래 [뒤로] · [그룹 만들기])
// · BE Swagger 10.1 그룹 만들기(Idempotency-Key · 201 → 대기실 · 409 ALREADY_IN_GROUP 서버 문구) · GroupCreateRequest
// · 사용자 결정(2026-11-13: 면접관 · 방식은 S04 · S05-1에서 고른 값을 쓰고 다시 묻지 않는다 · '그룹 직군' 아래 안내 문구는 두지 않는다
// · 지원서는 한 줄 칸 + [변경] 모달 · 빈칸 기본안: 그룹 직군은 Figma처럼 '개발'을 골라 둔다)
// [뒤로]는 고른 지원서 · 면접관으로 S05-1을 다시 연다(S05 [← 면접 방식]과 같은 주소).

const CAPACITY_CHOICES = GROUP_CAPACITIES.map((value) => ({ value, label: `${value}명` }));
const JOB_CHOICES = JOB_CATEGORIES.map(({ jobCategory, label }) => ({ value: jobCategory, label }));

export function GroupCreateForm({
  applications,
  initial,
}: Readonly<{
  applications: readonly ApplicationListItem[];
  /** S03 · S04 · S05-1에서 고른 지원서 · 면접관 · 방식 */
  initial: { applicationId: number; persona: Persona; mode: Mode };
}>) {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string>();
  // 10.1 멱등 키: 같은 본문을 다시 보내면 같은 키, 본문이 바뀌었거나 서버가 실패로 답했으면 새 키
  const requestKey = useRequestKey();
  const form = useForm<GroupCreateValues>({
    resolver: zodResolver(groupCreateSchema),
    defaultValues: { ...initial, capacity: 3, jobCategory: "DEVELOPMENT" },
  });
  const applicationId = useWatch({ control: form.control, name: "applicationId" });

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      setFormError(undefined);
      const result = await createGroup(values, requestKey.keyFor(values));
      if (result.formError) setFormError(result.formError);
      if (result.keySpent) requestKey.spend();
    }),
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center px-4 pt-10 pb-10">
        <div className="flex w-full max-w-[640px] flex-col gap-6">
          <div className="flex flex-col gap-1.5 leading-normal">
            <h1 className="text-[26px] font-bold text-text-1">함께 면접 볼 그룹을 만들어요</h1>
            <p className="text-[15px] font-medium text-text-2">
              만들면 초대 링크가 생겨요. 2~3명이 같은 면접관에게 차례로 답해요
            </p>
          </div>

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
            name="capacity"
            render={({ field }) => (
              <ChoiceChips
                legend="인원"
                name="capacity"
                choices={CAPACITY_CHOICES}
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
                legend="그룹 직군"
                name="jobCategory"
                choices={JOB_CHOICES}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />

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
        <GroupBackLink href={modePath(applicationId, initial.persona)}>뒤로</GroupBackLink>
        <GroupPrimaryButton pending={pending}>그룹 만들기</GroupPrimaryButton>
      </GroupActionBar>
    </form>
  );
}
