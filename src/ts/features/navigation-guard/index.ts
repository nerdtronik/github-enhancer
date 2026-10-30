/** Content script entry: installs the guard for the route group of the page being loaded. */
import { routeGroup } from "../../core/routes";
import { installNavigationGuard } from "./guard";

installNavigationGuard({
  loaded: routeGroup(),
  assign: (url) => location.assign(url),
  reload: () => location.reload(),
  getPathname: () => location.pathname,
});
