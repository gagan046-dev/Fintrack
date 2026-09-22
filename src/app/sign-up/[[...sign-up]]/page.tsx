import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { isClerkConfigured } from "@/lib/auth-context";

export default function SignUpPage() {
  if (!isClerkConfigured()) redirect("/");

  return <main className="auth-page"><SignUp /></main>;
}