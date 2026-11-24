import { DEMO_FIXTURES } from "@/lib/demo/fixtures.generated";
import { PERSONA_CODES, type PersonaCode } from "@/lib/db/schema";
import { formatVndText } from "@/lib/format/vnd";

/** Small serializable card model, built on the server so the client bundle skips the full fixtures. */
export interface PersonaCardModel {
  code: PersonaCode;
  name: string;
  story: string;
  balanceText: string;
  attention: boolean;
}

export function buildPersonaCards(): PersonaCardModel[] {
  return PERSONA_CODES.map((code) => {
    const persona = DEMO_FIXTURES.personas[code];
    return {
      code,
      name: persona.displayName,
      story: persona.story,
      balanceText: formatVndText(persona.profile.balanceSnapshotVnd),
      attention: code === "at_risk",
    };
  });
}
