// The suite: the tab holds the IntoMind One, and each page of the site is
// shown inside it. A browser gives a page only the device the person chose
// on that page, so every new page would have to ask again. Inside the
// suite, the device stays connected from page to page.
//
// Every page loads this. At the top of the tab it becomes the suite and
// shows its own page inside. Inside the suite, it runs the page.

/**
 * The mark on the address of a page shown inside the suite. A browser will
 * not show a page inside a page at the same address.
 */
const IN = "in";

if (window.top !== window) await import(new URL("main.js", location.href).href);
else host();

function host() {
  const root = document.documentElement;
  root.classList.add("suite");
  let device = null;
  window.__intomind = {
    /** The IntoMind One, as the page in `win` sees it. */
    async adopt(win) {
      device ??= import("./device.js").then(({ Device }) => new Device());
      return (await device).adopt(win);
    },
  };
  const frame = document.createElement("iframe");
  frame.className = "page";
  frame.title = document.title;
  frame.allow = "bluetooth; serial; usb; fullscreen; clipboard-write; autoplay";
  frame.addEventListener("load", () => shown(frame));
  frame.src = inside(location.href);
  document.body.append(frame);
}

/**
 * A page has loaded inside the suite: the tab takes its address and title,
 * links to other sites leave the suite, and keys go to the page.
 */
function shown(frame) {
  const doc = frame.contentDocument;
  // Another site, which this page cannot read: nothing to take from it.
  if (doc === null) return;
  const win = frame.contentWindow;
  const at = win.location.href;
  if (at === "about:blank") return;
  const root = document.documentElement;
  root.classList.add("shown");
  if (!marked(at)) win.history.replaceState(win.history.state, "", inside(at));
  history.replaceState(history.state, "", outside(at));
  document.title = doc.title || document.title;
  frame.title = document.title;
  const theme = () => { if (doc.documentElement.dataset.theme) root.dataset.theme = doc.documentElement.dataset.theme; };
  theme();
  win.addEventListener("themechange", theme);
  doc.addEventListener("click", (e) => follow(e, win), true);
  win.focus();
}

/** A link: another site opens in the whole tab, and a page of this site inside the suite. */
function follow(e, win) {
  if (e.defaultPrevented) return;
  const a = e.target.closest?.("a[href]");
  if (!a || a.target || a.hasAttribute("download")) return;
  const url = new URL(a.href, win.location.href);
  if (url.origin !== location.origin) { a.target = "_top"; return; }
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  a.href = inside(url.href);
}

function marked(href) {
  return new URL(href).search.slice(1).split("&").some((p) => p.split("=")[0] === IN);
}

/** The address of a page inside the suite. */
function inside(href) {
  if (marked(href)) return href;
  const u = new URL(href);
  u.search = u.search ? `${u.search}&${IN}` : `?${IN}`;
  return u.href;
}

/** The address the tab shows: the page's own, without the mark. */
function outside(href) {
  const u = new URL(href);
  const kept = u.search.slice(1).split("&").filter((p) => p && p.split("=")[0] !== IN);
  u.search = kept.length ? `?${kept.join("&")}` : "";
  return u.href;
}
