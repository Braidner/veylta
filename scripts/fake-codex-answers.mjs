// What every fake assistant answer starts from: the observation ids the prompt carried, and the
// three-way split — a ready profile with values gets the persona's plan, a resumed thread a general
// note, anything else the two missing blocks.
export function refsOf(prompt) {
  const ids = [...prompt.matchAll(/"observationId":"([0-9a-f-]{36})"/g)].map((match) => match[1]);
  return ids[0] === undefined ? [] : [{ observationId: ids[0] }];
}

/** Ready profile with values → the persona's plan; a resumed thread → a general note; else missing. */
export function answerOrMissing(args, prompt, plan) {
  const ref = refsOf(prompt);
  if (prompt.includes('"interpretationReady":true') && ref.length > 0) return plan(ref);
  if (args[1] === "resume") {
    return {
      urgency: { tier: "none", reasons: [] },
      blocks: [{ kind: "general", text: "В общем случае такой показатель оценивают в динамике." }],
    };
  }
  return {
    urgency: { tier: "none", reasons: [] },
    blocks: [
      { kind: "missing", context: "sex" },
      { kind: "missing", context: "birth_year" },
    ],
  };
}
