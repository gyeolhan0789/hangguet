import Image from "next/image";
import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-[9px] bg-linear-225 from-[#ffa766] from-15% to-brand-strong to-85%">
        <Image src="/icons/flame-logo.svg" alt="" width={18} height={18} />
      </span>
      <span className="text-xl leading-normal font-extrabold tracking-[-0.6px] text-text-1 group-data-[overlay=true]/header:text-white">
        한끗
      </span>
    </Link>
  );
}
