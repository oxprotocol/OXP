import { redirect } from "next/navigation";

export default function SignupRedirect() {
  redirect("/signin?mode=signup");
}
