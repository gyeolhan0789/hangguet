"use client";

// 기준: Figma [초안] G02 그룹 만들기(484:2505 칩: 높이 = 여백 8 + 14 글자, 좌우 14, 둥근 999, 사이 8
// · 고른 칩: brand-soft · 1.5px brand 테두리 · brand-ink Bold · 안 고른 칩: bg-sub · 1px line 테두리 · text-2 Medium)
// · G03 초대 확인(484:2552 '내 직군' 칩)

export interface Choice<T extends string | number> {
  value: T;
  label: string;
}

/** 칩 하나를 고르는 라디오 묶음. 이름(legend)은 Figma 필드 제목(14 Bold)이다 */
export function ChoiceChips<T extends string | number>({
  legend,
  name,
  choices,
  value,
  onChange,
}: Readonly<{
  legend: string;
  name: string;
  choices: readonly Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
}>) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2.5">
      <legend className="pb-2.5 text-sm leading-normal font-bold text-text-1">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => {
          const checked = choice.value === value;
          return (
            <label
              key={choice.value}
              className={`cursor-pointer rounded-full px-3.5 py-2 text-sm leading-normal whitespace-nowrap transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand ${checked ? "border-[1.5px] border-brand bg-brand-soft font-bold text-brand-ink dark:bg-brand-soft/8" : "border border-line bg-bg-sub font-medium text-text-2"}`}
            >
              <input
                type="radio"
                name={name}
                value={String(choice.value)}
                checked={checked}
                onChange={() => onChange(choice.value)}
                className="sr-only"
              />
              {choice.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
