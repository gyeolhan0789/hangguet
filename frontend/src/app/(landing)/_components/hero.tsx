"use client";

import {
  animate,
  motion,
  type MotionValue,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import Image, { getImageProps } from "next/image";
import Link from "next/link";
import { useEffect, useRef, type MouseEvent } from "react";

import { ROUTES } from "@/lib/routes";

import { Embers, type Ember } from "./motion-utils";

// Figma "Ember Particles (animated)" 26개 (1440×900 기준)
const HERO_EMBERS: readonly Ember[] = [
  [570.5, 355.5, 1.5, 0.26],
  [1028.5, 323.5, 1.5, 0.83],
  [933.5, 858.5, 2.5, 0.92],
  [505, 706, 4, 0.67],
  [927, 232, 3, 0.62],
  [747, 598, 2, 0.85],
  [467, 382, 2, 0.61],
  [479.5, 631.5, 1.5, 0.93],
  [1087, 325, 2, 0.67],
  [705.5, 220.5, 3.5, 0.35],
  [1052.5, 127.5, 1.5, 0.67],
  [1043, 213, 2, 0.62],
  [405, 705, 4, 0.63],
  [1072.5, 730.5, 2.5, 0.29],
  [391.5, 613.5, 2.5, 0.25],
  [1168, 541, 3, 0.82],
  [897, 854, 4, 0.18],
  [961, 552, 4, 0.69],
  [1204.5, 686.5, 2.5, 0.44],
  [1044.5, 348.5, 2.5, 0.83],
  [614.5, 131.5, 3.5, 0.67],
  [1100.5, 757.5, 3.5, 0.53],
  [1378, 558, 4, 0.49],
  [917.5, 225.5, 1.5, 0.56],
  [1150.5, 852.5, 3.5, 0.78],
  [502.5, 663.5, 2.5, 0.18],
];

/**
 * 면접관 배경 3장(하늘 · 실내 · 면접관)의 깊이. 멀수록 덜 움직여 깊이감을 낸다(패럴랙스).
 * mouse는 마우스 패럴랙스(Figma 모션 메모 ±12px)에 곱하는 배율로, 맨 앞 면접관이 Figma 값 그대로 움직인다.
 * scroll은 스크롤로 내려가는 거리(px). 멀수록 많이 내려가 천천히 지나가 보인다.
 * 기준: 사용자 결정(2026-10-22: 랜딩은 3장을 겹치고 층마다 깊이를 준다)
 */
const DEPTH = {
  sky: { mouse: 0.3, scroll: 120 },
  interior: { mouse: 0.6, scroll: 60 },
  devil: { mouse: 1, scroll: 0 },
} as const;

const SPEECH = "흐음~ ○○ 프로젝트라. 거기서 '직접' 한 부분만 쏙 골라서 말해볼래요?";
/** 말풍선 타이핑 글자. 글자는 겹칠 수 있어 문장 안 위치(position)를 key로 쓴다(고정 문장이라 순서가 바뀌지 않는다) */
const SPEECH_LETTERS = Array.from(SPEECH).map((char, position) => ({ char, position }));

const appear = (delay: number) =>
  ({
    initial: { opacity: 0, y: 24, filter: "blur(8px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: 0.7, ease: "easeOut", delay },
  }) as const;

function FloatChip({
  icon,
  label,
  className,
  delay,
  duration,
}: Readonly<{
  icon: string;
  label: string;
  className: string;
  delay: number;
  duration: number;
}>) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={`absolute hidden items-center gap-2 rounded-full border border-white/18 bg-white/12 px-4 py-3 backdrop-blur-[8px] lg:flex ${className}`}
      animate={reduce ? undefined : { y: [0, -10, 0] }}
      transition={{ duration, delay, repeat: Infinity, ease: "easeInOut" }}
    >
      <Image src={icon} alt="" width={18} height={18} />
      <span className="text-[15px] leading-normal font-bold whitespace-nowrap text-white">
        {label}
      </span>
    </motion.div>
  );
}

/** 세로 화면용 이미지를 쓰는 화면 비율(가로:세로 3:4 이하 — 폰 · 태블릿 세로) */
const PORTRAIT_MEDIA = "(max-aspect-ratio: 3/4)";

/**
 * 배경 한 층의 이미지. 세로 화면에서는 가로 그림(1672×941)의 좌우가 잘려 가운데만 보이므로,
 * 가운데 절반을 미리 자른 세로용 그림(836×941, public/landing/*-portrait.webp)을 받는다(아트 디렉션).
 * 세로용은 비율이 0.89라 세로 틀(비율 0.82 이하)을 object-cover로 채우면 높이에 맞춰 그려져 보이는 모습이 원본과 같다.
 * 기준: Next 문서 Image › Art direction(getImageProps + <picture>) · 사용자 결정(2026-11-10: 세로 화면용 크롭)
 * 미리 받기는 화면에 따라 LCP 후보가 달라지므로 preload 대신 맨 앞 층에 fetchPriority high를 건다(Next 문서 Image › preload).
 */
function HeroLayerImage({ name, lcp }: Readonly<{ name: string; lcp: boolean }>) {
  const common = {
    alt: "",
    fill: true,
    className: "object-cover",
    loading: "eager",
    fetchPriority: lcp ? "high" : undefined,
  } as const;
  const {
    props: { srcSet: portrait, sizes: portraitSizes },
  } = getImageProps({
    ...common,
    src: `/landing/${name}-portrait.webp`,
    // 세로 틀(층은 화면보다 6%쯤 크다)을 높이에 맞춰 채우므로 폭은 높이의 0.89배 남짓이다.
    sizes: "100vh",
  });
  const { props } = getImageProps({
    ...common,
    src: `/landing/${name}.webp`,
    // 가로 화면도 틀을 object-cover로 채우면 높이에 맞춰 커질 수 있어, 넉넉한 크기를 고르게 한다.
    sizes: "(min-width: 1024px) 100vw, 200vh",
  });
  return (
    <picture>
      <source media={PORTRAIT_MEDIA} srcSet={portrait} sizes={portraitSizes} />
      {/* getImageProps로 만든 props를 그대로 쓴다(Next 문서 Art direction) */}
      <img {...props} alt="" />
    </picture>
  );
}

/** 배경 한 층의 위치: 마우스 패럴랙스(x · y)에 깊이 배율을 곱하고, 스크롤한 만큼 깊이에 따라 아래로 내린다. */
function useDepth(
  x: MotionValue<number>,
  y: MotionValue<number>,
  scroll: MotionValue<number>,
  depth: (typeof DEPTH)[keyof typeof DEPTH],
) {
  return {
    x: useTransform(x, (value) => value * depth.mouse),
    y: useTransform([y, scroll], ([mouse, progress]: number[]) => {
      return mouse * depth.mouse + progress * depth.scroll;
    }),
  };
}

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // ⑦ 스크롤: 배경 확대·흐려짐, 카피 위로, 힌트 사라짐
  const { scrollYProgress, scrollY } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const bgScale = useTransform(scrollYProgress, [0, 1], [1, 1.1]);
  const bgOpacity = useTransform(scrollYProgress, [0, 1], [1, 0.3]);
  const copyY = useTransform(scrollYProgress, [0, 1], [0, -80]);
  const hintOpacity = useTransform(scrollY, [0, 80], [1, 0]);

  // ① 마우스 패럴랙스: x/y ±12px, rotateY ±3°
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const spring = { stiffness: 60, damping: 20 };
  const px = useSpring(useTransform(mouseX, [-1, 1], [-12, 12]), spring);
  const py = useSpring(useTransform(mouseY, [-1, 1], [-12, 12]), spring);
  const rotateY = useSpring(useTransform(mouseX, [-1, 1], [-3, 3]), spring);

  // ① 깊이: 층마다 마우스 패럴랙스 배율과 스크롤로 내려가는 거리를 달리한다.
  const sky = useDepth(px, py, scrollYProgress, DEPTH.sky);
  const interior = useDepth(px, py, scrollYProgress, DEPTH.interior);
  const devil = useDepth(px, py, scrollYProgress, DEPTH.devil);

  function handleMouseMove(e: MouseEvent<HTMLElement>) {
    if (reduce) return;
    mouseX.set((e.clientX / window.innerWidth) * 2 - 1);
    mouseY.set((e.clientY / window.innerHeight) * 2 - 1);
  }

  // ② 번개: 4~7초 랜덤 간격으로 번쩍, 그 순간 배경 밝기도 같이 올린다.
  useEffect(() => {
    if (reduce) return;
    let timer: ReturnType<typeof setTimeout>;
    const flash = () => {
      if (flashRef.current) {
        animate(flashRef.current, { opacity: [0, 0.7, 0, 0.4, 0] }, { duration: 0.6 });
      }
      if (photoRef.current) {
        animate(
          photoRef.current,
          { filter: ["brightness(1)", "brightness(1.4)", "brightness(1)"] },
          { duration: 0.6 },
        );
      }
      timer = setTimeout(flash, 4000 + Math.random() * 3000);
    };
    timer = setTimeout(flash, 2000);
    return () => clearTimeout(timer);
  }, [reduce]);

  return (
    <section
      ref={sectionRef}
      aria-labelledby="hero-title"
      onMouseMove={handleMouseMove}
      className="relative h-svh min-h-[720px] overflow-hidden bg-night"
    >
      {/* ① 배경 면접관 — 하늘 · 실내(창문만 뚫림) · 면접관 3장을 겹쳐 층마다 다르게 움직인다 */}
      {/* 층은 가장자리가 비지 않게 조금 크게 깔아 둔다. 넘친 부분이 왼쪽 그라데이션 밖으로 비치지 않게 자른다. */}
      <motion.div
        className="absolute inset-y-0 right-0 left-0 overflow-hidden lg:left-[27.8%]"
        style={{ scale: bgScale, opacity: bgOpacity }}
      >
        <motion.div className="absolute inset-0" style={{ rotateY }}>
          {/* 번개 밝기(Figma 1 → 1.4 → 1)는 세 층을 함께 감싼 이 상자에 건다. */}
          <motion.div
            ref={photoRef}
            data-testid="hero-backdrop"
            className="absolute inset-0"
            // 천천히 커졌다 작아진다(Figma 1 → 1.04 → 1 · 8초). 0 → 값 → 0 키프레임은 Motion 14에서 그려지지 않을 수 있어
            // 1 → 1.04를 왕복(mirror)한다(4초씩).
            animate={reduce ? undefined : { scale: 1.04 }}
            transition={{ duration: 4, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
          >
            {(
              [
                { name: "hero-sky", depth: sky, lcp: false },
                { name: "hero-interior", depth: interior, lcp: false },
                { name: "hero-devil", depth: devil, lcp: true },
              ] as const
            ).map(({ name, depth, lcp }) => (
              // 층이 움직여도 가장자리가 비지 않게 조금 크게 깐다(좁은 화면에서도 마우스 패럴랙스 최대 12px보다 크게).
              <motion.div
                key={name}
                data-testid="hero-layer"
                className="absolute -inset-[max(3%,16px)]"
                style={{ x: depth.x, y: depth.y }}
              >
                <HeroLayerImage name={name} lcp={lcp} />
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </motion.div>
      <div className="absolute inset-y-0 left-[27.8%] hidden w-[38.9%] bg-linear-to-l from-night/0 to-night lg:block" />
      <div className="absolute inset-0 bg-night/60 lg:hidden" />
      <div className="absolute inset-x-0 bottom-0 h-[31%] bg-linear-to-b from-night/0 to-night" />

      {/* ④ 주황 글로우 */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute top-[13.3%] left-[-12.5%] size-[820px]"
        animate={reduce ? undefined : { scale: [1, 1.15, 1], opacity: [0.75, 1, 0.75] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      >
        <Image src="/landing/glow-orb.svg" alt="" width={820} height={820} />
      </motion.div>

      {/* ② 번개 플래시 */}
      <div
        ref={flashRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_55%_at_72%_12%,rgba(185,212,255,0.22),rgba(185,212,255,0))] opacity-0"
      />

      {/* ③ 불씨 */}
      <Embers embers={HERO_EMBERS} width={1440} height={900} />

      {/* ⑤ 떠다니는 요소 */}
      <FloatChip
        icon="/landing/icon-flame-chip.svg"
        label="7일째 연속 연습"
        className="top-[76.7%] left-[52.8%]"
        delay={0}
        duration={6}
      />
      <FloatChip
        icon="/landing/icon-trending-up.svg"
        label="전달력 +8"
        className="top-[66.7%] left-[79.9%]"
        delay={1.2}
        duration={7}
      />
      <motion.div
        className="absolute top-[14.4%] left-[72.9%] hidden w-[330px] flex-col gap-1.5 rounded-[18px] border border-white/12 bg-[rgba(14,16,22,0.7)] px-5 py-4 backdrop-blur-[6px] lg:flex"
        animate={reduce ? undefined : { y: [0, -10, 0] }}
        transition={{ duration: 5, delay: 0.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <div className="flex items-center gap-1.5">
          <Image src="/landing/dot-brand.svg" alt="" width={8} height={8} />
          <span className="text-[13px] leading-normal font-bold text-brand">악마 면접관</span>
        </div>
        <p className="text-base leading-normal font-semibold text-white" aria-label={SPEECH}>
          {SPEECH_LETTERS.map(({ char, position }) => (
            <motion.span
              key={position}
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 + position * 0.03, duration: 0.01 }}
            >
              {char}
            </motion.span>
          ))}
        </p>
      </motion.div>

      {/* ⑥ 카피 */}
      <motion.div
        className="relative z-10 mx-auto flex h-full max-w-[1440px] flex-col justify-center gap-7 px-6 pb-[90px] sm:px-10 lg:px-[120px]"
        style={{ y: copyY }}
      >
        <h1
          id="hero-title"
          className="text-[44px] leading-[1.2] font-extrabold tracking-[-1.2px] text-white sm:text-[64px] lg:text-[80px] lg:tracking-[-2.4px]"
        >
          <motion.span className="block" {...appear(0.1)}>
            면접 준비,
          </motion.span>
          <motion.span className="block" {...appear(0.18)}>
            이제 <span className="text-brand">습관</span>처럼
          </motion.span>
        </h1>
        <motion.p
          className="text-lg leading-normal font-medium text-white/70 sm:text-[22px]"
          {...appear(0.5)}
        >
          말하는 동안 반응하는 면접관과 매일 10분씩
        </motion.p>
        <motion.div className="flex flex-wrap gap-3" {...appear(0.58)}>
          <Link
            href={ROUTES.signup}
            className="flex h-[60px] items-center gap-2 rounded-2xl bg-brand-strong px-7 text-lg font-bold text-white"
          >
            무료로 시작하기
            <Image src="/landing/icon-arrow-right.svg" alt="" width={20} height={20} />
          </Link>
          <a
            href="#steps"
            className="flex h-[60px] items-center rounded-2xl border border-white/20 bg-white/12 px-7 text-lg font-bold text-white"
          >
            어떻게 동작하나요?
          </a>
        </motion.div>
      </motion.div>

      {/* 스크롤 힌트 */}
      <motion.div
        aria-hidden
        className="absolute bottom-[50px] left-1/2 flex -translate-x-1/2 flex-col items-center gap-1"
        style={{ opacity: hintOpacity }}
      >
        <span className="text-[13px] leading-normal font-semibold text-white/50">
          아래로 스크롤
        </span>
        <motion.span
          animate={reduce ? undefined : { y: [0, 6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <Image src="/landing/icon-chevron-down.svg" alt="" width={20} height={20} />
        </motion.span>
      </motion.div>
    </section>
  );
}
