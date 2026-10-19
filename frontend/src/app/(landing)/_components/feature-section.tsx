import type { ReactNode } from "react";

import { Reveal } from "./motion-utils";

// Figma S00 Feature 1~3: 카피(480) + 그림(520), 간격 100. 좁은 화면에서는 카피가 위로 온다.
export function FeatureSection({
  id,
  eyebrow,
  title,
  body,
  visual,
  visualFirst = false,
}: {
  id?: string;
  eyebrow: string;
  title: readonly [string, string];
  body: string;
  visual: ReactNode;
  /** 넓은 화면에서 그림을 왼쪽에 둔다 */
  visualFirst?: boolean;
}) {
  return (
    <section
      id={id}
      className={`flex scroll-mt-18 flex-col items-center justify-center gap-14 bg-bg px-6 py-24 lg:h-[760px] lg:gap-[100px] lg:px-10 lg:py-0 ${visualFirst ? "lg:flex-row-reverse" : "lg:flex-row"}`}
    >
      <Reveal className="flex w-full max-w-[480px] flex-col gap-5">
        <p className="text-lg leading-normal font-bold text-brand-ink">{eyebrow}</p>
        <h2 className="text-[36px] leading-[1.25] font-extrabold tracking-[-1.2px] text-text-1 lg:text-[52px] lg:tracking-[-1.6px]">
          {title[0]}
          <br />
          {title[1]}
        </h2>
        <p className="max-w-[440px] text-lg leading-[1.6] font-medium whitespace-pre-line text-text-2 lg:text-xl">
          {body}
        </p>
      </Reveal>
      {visual}
    </section>
  );
}
