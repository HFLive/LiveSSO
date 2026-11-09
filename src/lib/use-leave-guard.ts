"use client";

import { useEffect, useRef } from "react";

export function confirmPageLeave() {
  return document.dispatchEvent(new Event("hflive:before-leave", { cancelable: true }));
}

export function finishPageLeave() {
  document.dispatchEvent(new Event("hflive:leave-committed"));
}

export function useLeaveGuard(active: boolean, message = "你有尚未保存的更改，确定离开此页面吗？") {
  const enabled = useRef(active);
  useEffect(() => { enabled.current = active; }, [active]);
  useEffect(() => {
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    let approvedDestination: string | undefined;
    function beforeUnload(event: BeforeUnloadEvent) { if (enabled.current && !approvedDestination) { event.preventDefault(); event.returnValue = ""; } approvedDestination = undefined; }
    function onNavigate(event: Event) {
      const navigationEvent = event as Event & { destination?: { url: string; sameDocument: boolean }; hashChange?: boolean; navigationType?: string };
      const destination = navigationEvent.destination;
      // Link clicks are checked before Next.js handles them. Only native history traversal is intercepted here.
      if (navigationEvent.navigationType !== "traverse") {
        if (destination?.sameDocument || destination?.url !== approvedDestination) approvedDestination = undefined;
        return;
      }
      if (!enabled.current || !event.cancelable || !destination || destination.url === window.location.href || navigationEvent.hashChange) return;
      if (!window.confirm(message)) event.preventDefault();
      else approvedDestination = destination.url;
    }
    function onClick(event: MouseEvent) {
      if (!enabled.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.download || anchor.href === window.location.href) return;
      if (!window.confirm(message)) { event.preventDefault(); event.stopPropagation(); }
      else if (navigation) approvedDestination = anchor.href;
    }
    function onExplicitLeave(event: Event) { if (enabled.current && !window.confirm(message)) event.preventDefault(); }
    function onLeaveCommitted() { enabled.current = false; }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    document.addEventListener("hflive:before-leave", onExplicitLeave);
    document.addEventListener("hflive:leave-committed", onLeaveCommitted);
    navigation?.addEventListener("navigate", onNavigate);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", onClick, true); document.removeEventListener("hflive:before-leave", onExplicitLeave); document.removeEventListener("hflive:leave-committed", onLeaveCommitted); navigation?.removeEventListener("navigate", onNavigate); };
  }, [message]);
  return () => { enabled.current = false; };
}
