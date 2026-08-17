"use client";

import type { MedicalProfileResponse } from "@veylta/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "../api-client";
import { identityChips, passportOf } from "../dossier-passport";
import { profileTabPath } from "../paths";
import { medicalProfilePath } from "./medical-profile-controls";

interface IdentityChipsProps {
  readonly familyId: string;
  readonly profileId: string;
}

/**
 * The person's own facts in the profile heading — sex and age, height, weight — so every tab
 * shows who this record is about. Until sex and birth year are recorded the chip is the way to
 * the dossier, where the passport asks for them.
 */
export function IdentityChips({ familyId, profileId }: IdentityChipsProps) {
  const [profile, setProfile] = useState<MedicalProfileResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<MedicalProfileResponse>(medicalProfilePath(familyId, profileId), {
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) setProfile(response);
      })
      .catch(() => {
        // The heading is decoration over the record; the dossier reports its own errors.
      });
    return () => controller.abort();
  }, [familyId, profileId]);

  if (profile === null) return null;
  const passport = passportOf(profile.entries, new Date());
  const chips = identityChips(passport);
  return (
    <>
      {chips.map((chip) => (
        <span key={chip} className="profile-heading__identity">
          {chip}
        </span>
      ))}
      {passport.ready ? null : (
        <Link
          className="profile-heading__identity profile-heading__identity--missing"
          href={profileTabPath(familyId, profileId, "dossier")}
        >
          Указать пол и год рождения
        </Link>
      )}
    </>
  );
}
