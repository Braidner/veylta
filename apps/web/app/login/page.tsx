import { VeyltaApp } from "../components/veylta-app";

/** Sign-in (or first-administrator setup); a signed-in session is sent to its first profile. */
export default function LoginPage() {
  return <VeyltaApp requestedLogin />;
}
