// Why this page cannot reach an IntoMind One, found out rather than assumed:
// the address, the browser, the system, and whether there is a Bluetooth radio.

const UA = typeof navigator === "undefined" ? "" : navigator.userAgent;
const brands = typeof navigator !== "undefined" && navigator.userAgentData ? navigator.userAgentData.brands.map((b) => b.brand).join(" ") : "";

export const browser = /Edg\//.test(UA) || /Microsoft Edge/.test(brands) ? "Edge"
  : /OPR\//.test(UA) ? "Opera"
  : /Firefox\//.test(UA) ? "Firefox"
  : /Chrome\//.test(UA) || /Chromium|Google Chrome/.test(brands) ? "Chrome"
  : /Safari\//.test(UA) ? "Safari"
  : "this browser";

export const system = /iPhone|iPad|iPod/.test(UA) ? "iOS"
  : /Android/.test(UA) ? "Android"
  : /CrOS/.test(UA) ? "ChromeOS"
  : /Macintosh/.test(UA) ? "macOS"
  : /Windows/.test(UA) ? "Windows"
  : /Linux/.test(UA) ? "Linux"
  : "this system";

const chromeLike = browser === "Chrome" || browser === "Edge" || browser === "Opera";
const flags = browser === "Edge" ? "edge://flags" : browser === "Opera" ? "opera://flags" : "chrome://flags";

/**
 * Null when the IntoMind One can be reached. Otherwise what is in the way and
 * what to do about it, in the order a person can act on it.
 */
export async function whyNoBluetooth() {
  if (typeof navigator === "undefined") return null;
  if (system === "iOS") {
    return { why: "No Bluetooth on iPhone or iPad", text: "No browser on an iPhone or iPad can reach a Bluetooth device from a web page. Open this on a computer in Chrome or Edge, or on an Android phone in Chrome." };
  }
  if (browser === "Firefox" || browser === "Safari") {
    return { why: `${browser} cannot reach your IntoMind One`, text: `${browser} has no Web Bluetooth. Open this in Chrome or Edge on a computer, or in Chrome on Android.` };
  }
  if (!window.isSecureContext) {
    const origin = location.origin;
    return {
      why: "This address is http, so the browser hides Bluetooth from it",
      text: `${browser} only lets a page reach Bluetooth over https or at localhost. This page is at ${origin}. To allow it on this computer:`,
      steps: [
        `Open a new tab and go to <code>${flags}/#unsafely-treat-insecure-origin-as-secure</code>`,
        `Paste <code>${origin}</code> into the box and set it to Enabled`,
        "Press Relaunch at the bottom, then come back here",
      ],
      copy: origin,
    };
  }
  if (!("bluetooth" in navigator)) {
    if (chromeLike && system === "Linux") {
      return {
        why: `Bluetooth is turned off in ${browser} on Linux`,
        text: `${browser} on Linux keeps Web Bluetooth behind a flag. To turn it on:`,
        steps: [
          `Open a new tab and go to <code>${flags}/#enable-web-bluetooth</code>`,
          "Set it to Enabled",
          "Press Relaunch at the bottom, then come back here",
        ],
      };
    }
    if (chromeLike) {
      return { why: `${browser} is not offering Bluetooth`, text: `${browser} on ${system} normally has Web Bluetooth. Update ${browser}, and if it is managed by an organization, ask whether Web Bluetooth has been switched off by policy.` };
    }
    return { why: `${browser} cannot reach your IntoMind One`, text: "Open this in Chrome or Edge on a computer, or in Chrome on Android." };
  }
  try {
    if (navigator.bluetooth.getAvailability && !(await navigator.bluetooth.getAvailability())) {
      return { why: "This computer has no Bluetooth on", text: "The browser is ready, but the computer reports no Bluetooth radio, or it is switched off. Turn Bluetooth on in the system settings, or plug in an adapter, then check again." };
    }
  } catch {
    // A browser that cannot say is a browser that will ask when the time comes.
  }
  return null;
}
