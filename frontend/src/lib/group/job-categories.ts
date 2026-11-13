import type { JobCategory } from "@/types/api";

// 기준: BE Swagger 10.1 GroupCreateRequest.jobCategory · Figma [초안] G02 그룹 만들기(484:2318 '그룹 직군' 칩 순서 · 이름)
// · 사용자 결정(2026-11-13: ETC는 '기타' 대신 '없음')

// Record<JobCategory, …>라서 값이 늘거나 줄면 여기서 컴파일 오류가 난다. 적은 순서가 화면 순서(Figma)다.
const JOB_CATEGORY_LABEL = {
  DEVELOPMENT: "개발",
  DATA_AI: "데이터·AI",
  DESIGN: "디자인",
  PLANNING: "기획",
  MARKETING: "마케팅",
  SALES: "영업",
  MANAGEMENT_SUPPORT: "경영지원",
  ETC: "없음",
} satisfies Record<JobCategory, string>;

export const JOB_CATEGORIES = (Object.keys(JOB_CATEGORY_LABEL) as JobCategory[]).map(
  (jobCategory) => ({ jobCategory, label: JOB_CATEGORY_LABEL[jobCategory] }),
);

export const JOB_CATEGORY_VALUES = JOB_CATEGORIES.map(({ jobCategory }) => jobCategory) as [
  JobCategory,
  ...JobCategory[],
];

export const jobCategoryLabel = (jobCategory: JobCategory) => JOB_CATEGORY_LABEL[jobCategory];
