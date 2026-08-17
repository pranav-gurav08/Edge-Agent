import type { InjectionIncident } from "./state.js";

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "ignore_previous", re: /ignore\s+(?:all\s+)?previous\s+(?:instructions|directives|prompts)/i },
  { name: "system_prompt_override", re: /system\s*prompt\s*[:=]/i },
  { name: "you_are_now", re: /you\s+are\s+now\s+(?:a|an)\s+/i },
  { name: "execute_command", re: /(?:execute|run|eval)\s+(?:a\s+)?(?:shell|os|command)/i },
  { name: "disregard_above", re: /disregard\s+(?:the\s+)?(?:above|prior|earlier)/i },
  { name: "new_instructions", re: /new\s+instructions\s*:/i },
];

export function scanForInjection(text: string, filePath: string): InjectionIncident[] {
  const incidents: InjectionIncident[] = [];
  for (const { name, re } of PATTERNS) {
    const m = text.match(re);
    if (m) {
      incidents.push({
        filePath,
        pattern: name,
        severity: "CRITICAL",
        description: `Indirect prompt injection pattern '${name}' detected: "${m[0].slice(0, 80)}"`,
      });
    }
  }
  return incidents;
}
