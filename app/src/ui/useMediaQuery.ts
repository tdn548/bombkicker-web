import { useSyncExternalStore } from "react";

/** Live `matchMedia` result (false where matchMedia is missing, e.g. some test environments). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof matchMedia !== "function") return () => {};
      const mq = matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => (typeof matchMedia === "function" ? matchMedia(query).matches : false),
  );
}

/** ux-spec 6.1: width < 768 CSS px = phone layout (bottom sheet, single column). */
export const PHONE_QUERY = "(max-width: 767px)";
