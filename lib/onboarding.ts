/** Bump the version when the onboarding changes so everyone sees it again. */
export const ONBOARDING_ACK_KEY = "angler-terminal:alpha-ack:v3";

/**
 * Runs in <head> before the first paint: marks `html[data-welcome]` when this browser hasn't finished the onboarding,
 * so the server-rendered welcome step can open at once (it is the first visit's largest paint) instead of after
 * hydration.
 */
export const onboardingScript = `try{if(localStorage.getItem(${JSON.stringify(
  ONBOARDING_ACK_KEY,
)})!=="1")document.documentElement.dataset.welcome="1"}catch(e){document.documentElement.dataset.welcome="1"}`;

/**
 * Placed right after the onboarding dialog in the HTML: opens it as a real modal before React loads. Opening it later
 * would move it into the top layer after its first paint, which the browser counts as a new, later largest paint.
 */
export const openOnboardingScript = `try{var d=document.querySelector("dialog.welcome-dialog");if(d&&!d.open&&document.documentElement.dataset.welcome)d.showModal()}catch(e){}`;
