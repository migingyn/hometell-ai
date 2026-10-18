let context;
let interval;
let active = [];
const played = new Map();
export async function enableSound() {
  context ||= new AudioContext();
  await context.resume();
  tone();
}
function tone() {
  if (!context || context.state !== 'running') return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.connect(gain); gain.connect(context.destination);
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0, context.currentTime);
  gain.gain.linearRampToValueAtTime(0.15, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.5);
  oscillator.start(); oscillator.stop(context.currentTime + 0.5);
}
export function updateAlerts(alerts) {
  interval ||= setInterval(check, 1000);
  active = alerts.filter(a => a.urgency === 'now');
  for (const id of played.keys()) if (!active.some(a => a.id === id)) played.delete(id);
  check();
}
function check() {
  if (!context || context.state !== 'running') return;
  let due = false;
  for (const a of active) {
    if (Date.now() - (played.get(a.id) || 0) >= (a.type === 'crisis_no_response' ? 10000 : 30000)) { played.set(a.id, Date.now()); due = true; }
  }
  if (due) tone();
}
export function stopSound() {
  clearInterval(interval);
  interval = undefined;
  active = [];
  played.clear();
}
