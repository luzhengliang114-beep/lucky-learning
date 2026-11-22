import React from "react";
import type { AppRoute } from "./appTypes";

const routes = new Set<AppRoute>(["home", "learning", "exam", "phrases", "cases", "rewards", "ranking", "profile", "search", "boundary"]);

function routeFromHash(): AppRoute {
  const value = window.location.hash.replace(/^#\/?/, "").split("/")[0] as AppRoute;
  return routes.has(value) ? value : "home";
}

function initialRouteFromLocation(): AppRoute {
  // Older scan QR codes pointed at the phrases page. A scan is an entry
  // action, so normalize that first screen to Home while keeping normal
  // in-app navigation to Phrases unchanged.
  const entry = new URLSearchParams(window.location.search).get("entry");
  const route = routeFromHash();
  if (entry === "scan" && route === "phrases") {
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}#/home`);
    return "home";
  }
  return route;
}

export function useHashRoute() {
  const [route, setRoute] = React.useState<AppRoute>(initialRouteFromLocation);
  const scrollPositions = React.useRef<Record<string, number>>({});
  const currentRoute = React.useRef(route);

  React.useEffect(() => {
    const onHashChange = () => {
      scrollPositions.current[currentRoute.current] = window.scrollY;
      const nextRoute = routeFromHash();
      currentRoute.current = nextRoute;
      setRoute(nextRoute);
      window.requestAnimationFrame(() => window.scrollTo({ top: scrollPositions.current[nextRoute] || 0 }));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function navigate(nextRoute: AppRoute) {
    if (nextRoute === route) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.location.hash = `/${nextRoute}`;
  }

  return { route, navigate };
}
