"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./ProgramBuilder.module.css";

export function ProgramTabs({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = ref.current;
    const selected = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !selected) return;
    nav.scrollLeft += selected.getBoundingClientRect().left - nav.getBoundingClientRect().left -
      (nav.clientWidth - selected.offsetWidth) / 2;
  }, [children]);
  return <nav ref={ref} className={styles.tabs} aria-label={label}>{children}</nav>;
}
