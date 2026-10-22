// The start: the mark, five names, and the light.

import { applyTheme, isDark, ready } from "./lib/shell.js";

document.querySelector(".theme").addEventListener("click", () => applyTheme(isDark() ? "light" : "dark"));
ready();
